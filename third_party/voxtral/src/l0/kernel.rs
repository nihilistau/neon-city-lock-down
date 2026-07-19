//! SPIR-V kernel loading and dispatch for Level Zero.
//!
//! Loads pre-compiled SPIR-V modules (from naga WGSL→SPIR-V translation)
//! and dispatches compute kernels on the iGPU.
//!
//! # Kernel Pipeline
//!
//! ```text
//! WGSL (shader_naive.wgsl) → naga → SPIR-V binary → zeModuleCreate → zeKernelCreate
//!                                                         ↓
//!                              zeKernelSetArgumentValue (USM pointers)
//!                                         ↓
//!                              zeCommandListAppendLaunchKernel
//!                                         ↓
//!                              zeCommandQueueExecuteCommandLists
//! ```

use super::device::L0Context;
use super::sys;
use anyhow::{bail, Result};
use std::ffi::{c_void, CString};
use std::ptr;

/// A compiled SPIR-V module loaded on the L0 device.
pub struct L0Module {
    handle: sys::ze_module_handle_t,
}

impl L0Module {
    /// Load a SPIR-V binary as an L0 module.
    ///
    /// NOTE: The SPIR-V must use the Kernel execution model (OpenCL flavor).
    /// Vulkan-flavor SPIR-V (from naga) uses GLSL.std.450 which Intel IGC rejects.
    /// Use `from_native()` with OpenCL-compiled binaries instead.
    pub fn from_spirv(ctx: &L0Context, spirv: &[u8]) -> Result<Self> {
        let desc = sys::ze_module_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_MODULE_DESC,
            pNext: ptr::null(),
            format: sys::ZE_MODULE_FORMAT_IL_SPIRV,
            inputSize: spirv.len(),
            pInputModule: spirv.as_ptr(),
            pBuildFlags: ptr::null(),
            pConstants: ptr::null(),
        };

        let mut module: sys::ze_module_handle_t = ptr::null_mut();
        let mut build_log: *mut c_void = ptr::null_mut();

        let r = unsafe {
            sys::zeModuleCreate(
                ctx.context,
                ctx.device.handle,
                &desc,
                &mut module,
                &mut build_log,
            )
        };

        if r != 0 {
            bail!("zeModuleCreate (SPIR-V) failed: 0x{:08x}", r);
        }

        Ok(L0Module { handle: module })
    }

    /// Load a native binary (e.g., from OpenCL's clGetProgramInfo) as an L0 module.
    ///
    /// This is the preferred path for Intel GPUs: compile OpenCL C source via
    /// the OpenCL runtime (which uses IGC internally), extract the native binary,
    /// then load it here. This avoids SPIR-V flavor mismatches entirely.
    pub fn from_native(ctx: &L0Context, native_binary: &[u8]) -> Result<Self> {
        let desc = sys::ze_module_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_MODULE_DESC,
            pNext: ptr::null(),
            format: sys::ZE_MODULE_FORMAT_NATIVE,
            inputSize: native_binary.len(),
            pInputModule: native_binary.as_ptr(),
            pBuildFlags: ptr::null(),
            pConstants: ptr::null(),
        };

        let mut module: sys::ze_module_handle_t = ptr::null_mut();
        let mut build_log: *mut c_void = ptr::null_mut();

        let r = unsafe {
            sys::zeModuleCreate(
                ctx.context,
                ctx.device.handle,
                &desc,
                &mut module,
                &mut build_log,
            )
        };

        if r != 0 {
            bail!("zeModuleCreate (native) failed: 0x{:08x}", r);
        }

        Ok(L0Module { handle: module })
    }

    /// Create a kernel from this module by entry point name.
    pub fn create_kernel(&self, name: &str) -> Result<L0Kernel> {
        let c_name = CString::new(name)
            .map_err(|_| anyhow::anyhow!("Kernel name contains null byte"))?;

        let desc = sys::ze_kernel_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_KERNEL_DESC,
            pNext: ptr::null(),
            flags: 0,
            pKernelName: c_name.as_ptr(),
        };

        let mut kernel: sys::ze_kernel_handle_t = ptr::null_mut();
        let r = unsafe { sys::zeKernelCreate(self.handle, &desc, &mut kernel) };
        if r != 0 {
            bail!("zeKernelCreate('{}') failed: 0x{:08x}", name, r);
        }

        Ok(L0Kernel {
            handle: kernel,
            name: name.to_string(),
        })
    }
}

impl Drop for L0Module {
    fn drop(&mut self) {
        unsafe {
            sys::zeModuleDestroy(self.handle);
        }
    }
}

/// A single compute kernel ready for argument binding and dispatch.
pub struct L0Kernel {
    handle: sys::ze_kernel_handle_t,
    pub name: String,
}

impl L0Kernel {
    /// Set the workgroup size for this kernel.
    pub fn set_group_size(&self, x: u32, y: u32, z: u32) -> Result<()> {
        let r = unsafe { sys::zeKernelSetGroupSize(self.handle, x, y, z) };
        if r != 0 {
            bail!("zeKernelSetGroupSize failed: 0x{:08x}", r);
        }
        Ok(())
    }

    /// Set a kernel argument to a USM pointer.
    ///
    /// For buffer arguments, pass a pointer to the USM allocation's raw pointer.
    pub fn set_arg_ptr<T>(&self, index: u32, ptr: *const T) -> Result<()> {
        // L0 expects a pointer TO the pointer for USM arguments
        let r = unsafe {
            sys::zeKernelSetArgumentValue(
                self.handle,
                index,
                std::mem::size_of::<*const T>(),
                &ptr as *const *const T as *const c_void,
            )
        };
        if r != 0 {
            bail!("zeKernelSetArgumentValue(idx={}) failed: 0x{:08x}", index, r);
        }
        Ok(())
    }

    /// Set a kernel argument to a scalar value (e.g., dimensions).
    pub fn set_arg_scalar<T: Copy>(&self, index: u32, value: &T) -> Result<()> {
        let r = unsafe {
            sys::zeKernelSetArgumentValue(
                self.handle,
                index,
                std::mem::size_of::<T>(),
                value as *const T as *const c_void,
            )
        };
        if r != 0 {
            bail!("zeKernelSetArgumentValue(idx={}, scalar) failed: 0x{:08x}", index, r);
        }
        Ok(())
    }

    /// Append this kernel to a command list for later execution.
    pub fn append_to_command_list(
        &self,
        cmd_list: sys::ze_command_list_handle_t,
        group_count_x: u32,
        group_count_y: u32,
        group_count_z: u32,
    ) -> Result<()> {
        let group_count = sys::ze_group_count_t {
            groupCountX: group_count_x,
            groupCountY: group_count_y,
            groupCountZ: group_count_z,
        };

        let r = unsafe {
            sys::zeCommandListAppendLaunchKernel(
                cmd_list,
                self.handle,
                &group_count,
                ptr::null_mut(), // no signal event
                0,
                ptr::null(),
            )
        };
        if r != 0 {
            bail!("zeCommandListAppendLaunchKernel('{}') failed: 0x{:08x}", self.name, r);
        }
        Ok(())
    }

    /// Convenience: dispatch this kernel synchronously on the given context.
    pub fn dispatch(
        &self,
        ctx: &L0Context,
        group_count_x: u32,
        group_count_y: u32,
        group_count_z: u32,
    ) -> Result<()> {
        let cmd_list = ctx.create_command_list()?;

        self.append_to_command_list(cmd_list, group_count_x, group_count_y, group_count_z)?;

        // Add barrier to ensure kernel completion is visible to host
        let r = unsafe {
            sys::zeCommandListAppendBarrier(cmd_list, ptr::null_mut(), 0, ptr::null())
        };
        if r != 0 {
            unsafe { sys::zeCommandListDestroy(cmd_list) };
            bail!("zeCommandListAppendBarrier failed: 0x{:08x}", r);
        }

        let r = unsafe { sys::zeCommandListClose(cmd_list) };
        if r != 0 {
            unsafe { sys::zeCommandListDestroy(cmd_list) };
            bail!("zeCommandListClose failed: 0x{:08x}", r);
        }

        ctx.submit_and_sync(cmd_list)?;

        unsafe { sys::zeCommandListDestroy(cmd_list) };
        Ok(())
    }
}

impl Drop for L0Kernel {
    fn drop(&mut self) {
        unsafe {
            sys::zeKernelDestroy(self.handle);
        }
    }
}

/// Convert WGSL shader source to SPIR-V bytes using naga.
///
/// This is used at build time or first-run to compile our Q4 matmul
/// shader into SPIR-V for L0 consumption.
pub fn wgsl_to_spirv(wgsl_source: &str) -> Result<Vec<u8>> {
    // Parse WGSL
    let module = naga::front::wgsl::parse_str(wgsl_source)
        .map_err(|e| anyhow::anyhow!("WGSL parse error: {:?}", e))?;

    // Validate
    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    );
    let info = validator
        .validate(&module)
        .map_err(|e| anyhow::anyhow!("WGSL validation error: {:?}", e))?;

    // Write SPIR-V
    let options = naga::back::spv::Options {
        lang_version: (1, 3), // SPIR-V 1.3 — well supported by Intel drivers
        flags: naga::back::spv::WriterFlags::empty(),
        ..Default::default()
    };

    let spirv = naga::back::spv::write_vec(&module, &info, &options, None)
        .map_err(|e| anyhow::anyhow!("SPIR-V codegen error: {:?}", e))?;

    // Convert Vec<u32> to Vec<u8>
    let bytes: Vec<u8> = spirv
        .iter()
        .flat_map(|word| word.to_le_bytes())
        .collect();

    Ok(bytes)
}
