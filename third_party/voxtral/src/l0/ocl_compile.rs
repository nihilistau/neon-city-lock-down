//! OpenCL runtime compilation for generating SPIR-V compatible with Intel IGC.
//!
//! Intel's Level Zero expects SPIR-V with the Kernel execution model (OpenCL flavor).
//! Naga generates Vulkan-flavor SPIR-V (Shader execution model, GLSL.std.450) which
//! IGC rejects. The workaround is to use OpenCL's runtime compiler to build our
//! kernel source into a binary that L0 can consume.
//!
//! Strategy: use OpenCL.dll (always present on Intel GPU systems) to compile
//! OpenCL C source → program binary (Gen ISA), then pass that to L0 as native format.
//! Alternatively, request SPIR-V IL output from clGetProgramInfo.
//!
//! This avoids needing ocloc, oneAPI, or any external toolchain.

use anyhow::{bail, Result};
use std::ffi::{c_void, CString};
use std::ptr;
use std::sync::OnceLock;

// OpenCL types
type ClInt = i32;
type ClUint = u32;
type ClPlatformId = *mut c_void;
type ClDeviceId = *mut c_void;
type ClContext = *mut c_void;
type ClProgram = *mut c_void;
type ClCommandQueue = *mut c_void;

// OpenCL constants
const CL_SUCCESS: ClInt = 0;
const CL_DEVICE_TYPE_GPU: u64 = 4;
const CL_PROGRAM_BINARY_SIZES: ClUint = 0x1165;
const CL_PROGRAM_BINARIES: ClUint = 0x1166;
const CL_DEVICE_VENDOR: ClUint = 0x102C;

static OCL_LIB: OnceLock<libloading::Library> = OnceLock::new();

fn ocl_lib() -> &'static libloading::Library {
    OCL_LIB.get_or_init(|| unsafe {
        libloading::Library::new("OpenCL.dll")
            .expect("Failed to load OpenCL.dll — is Intel GPU driver installed?")
    })
}

macro_rules! ocl_fn {
    ($name:ident ( $($arg:ident : $ty:ty),* ) -> $ret:ty) => {
        unsafe fn $name($($arg: $ty),*) -> $ret {
            let f: libloading::Symbol<unsafe extern "C" fn($($ty),*) -> $ret> =
                ocl_lib().get(stringify!($name).as_bytes()).unwrap();
            f($($arg),*)
        }
    };
}

ocl_fn!(clGetPlatformIDs(num: ClUint, platforms: *mut ClPlatformId, count: *mut ClUint) -> ClInt);
ocl_fn!(clGetDeviceIDs(platform: ClPlatformId, devtype: u64, num: ClUint, devices: *mut ClDeviceId, count: *mut ClUint) -> ClInt);
ocl_fn!(clGetDeviceInfo(device: ClDeviceId, param: ClUint, size: usize, value: *mut c_void, ret_size: *mut usize) -> ClInt);
ocl_fn!(clCreateContext(props: *const isize, num: ClUint, devices: *const ClDeviceId, callback: *const c_void, userdata: *mut c_void, err: *mut ClInt) -> ClContext);
ocl_fn!(clCreateProgramWithSource(ctx: ClContext, count: ClUint, strings: *const *const i8, lengths: *const usize, err: *mut ClInt) -> ClProgram);
ocl_fn!(clBuildProgram(program: ClProgram, num: ClUint, devices: *const ClDeviceId, options: *const i8, callback: *const c_void, userdata: *mut c_void) -> ClInt);
ocl_fn!(clGetProgramBuildInfo(program: ClProgram, device: ClDeviceId, param: ClUint, size: usize, value: *mut c_void, ret_size: *mut usize) -> ClInt);
ocl_fn!(clGetProgramInfo(program: ClProgram, param: ClUint, size: usize, value: *mut c_void, ret_size: *mut usize) -> ClInt);
ocl_fn!(clReleaseProgram(program: ClProgram) -> ClInt);
ocl_fn!(clReleaseContext(ctx: ClContext) -> ClInt);

/// OpenCL-based compiler that produces native GPU binaries from OpenCL C source.
pub struct OclCompiler {
    platform: ClPlatformId,
    device: ClDeviceId,
    context: ClContext,
}

impl OclCompiler {
    /// Initialize the OpenCL compiler, selecting the Intel GPU device.
    pub fn new() -> Result<Self> {
        unsafe {
            // Get platforms
            let mut num_platforms: ClUint = 0;
            let r = clGetPlatformIDs(0, ptr::null_mut(), &mut num_platforms);
            if r != CL_SUCCESS || num_platforms == 0 {
                bail!("No OpenCL platforms found");
            }

            let mut platforms = vec![ptr::null_mut(); num_platforms as usize];
            clGetPlatformIDs(num_platforms, platforms.as_mut_ptr(), ptr::null_mut());

            // Find Intel GPU device
            let mut found_device: Option<(ClPlatformId, ClDeviceId)> = None;
            for &platform in &platforms {
                let mut num_devices: ClUint = 0;
                let r = clGetDeviceIDs(platform, CL_DEVICE_TYPE_GPU, 0, ptr::null_mut(), &mut num_devices);
                if r != CL_SUCCESS || num_devices == 0 {
                    continue;
                }

                let mut devices = vec![ptr::null_mut(); num_devices as usize];
                clGetDeviceIDs(platform, CL_DEVICE_TYPE_GPU, num_devices, devices.as_mut_ptr(), ptr::null_mut());

                for &device in &devices {
                    let mut vendor = vec![0u8; 256];
                    let mut vendor_len: usize = 0;
                    clGetDeviceInfo(
                        device, CL_DEVICE_VENDOR, 256,
                        vendor.as_mut_ptr() as *mut c_void, &mut vendor_len,
                    );
                    let vendor_str = String::from_utf8_lossy(&vendor[..vendor_len.saturating_sub(1)]);
                    if vendor_str.contains("Intel") {
                        found_device = Some((platform, device));
                        break;
                    }
                }
                if found_device.is_some() {
                    break;
                }
            }

            let (platform, device) = found_device
                .ok_or_else(|| anyhow::anyhow!("No Intel GPU found via OpenCL"))?;

            // Create context
            let mut err: ClInt = 0;
            let context = clCreateContext(
                ptr::null(), 1, &device, ptr::null(), ptr::null_mut(), &mut err,
            );
            if err != CL_SUCCESS || context.is_null() {
                bail!("clCreateContext failed: {}", err);
            }

            Ok(OclCompiler { platform, device, context })
        }
    }

    /// Compile OpenCL C source to a native binary for the Intel GPU.
    ///
    /// Returns the compiled program binary that can be loaded via
    /// `zeModuleCreate` with `ZE_MODULE_FORMAT_NATIVE`.
    pub fn compile_to_binary(&self, source: &str, build_opts: &str) -> Result<Vec<u8>> {
        unsafe {
            let c_source = CString::new(source)?;
            let source_ptr = c_source.as_ptr();
            let source_len = source.len();

            let mut err: ClInt = 0;
            let program = clCreateProgramWithSource(
                self.context, 1, &source_ptr, &source_len, &mut err,
            );
            if err != CL_SUCCESS || program.is_null() {
                bail!("clCreateProgramWithSource failed: {}", err);
            }

            // Build with options
            let c_opts = CString::new(build_opts)?;
            let r = clBuildProgram(
                program, 1, &self.device, c_opts.as_ptr(), ptr::null(), ptr::null_mut(),
            );
            if r != CL_SUCCESS {
                // Get build log
                let mut log_size: usize = 0;
                clGetProgramBuildInfo(
                    program, self.device, 0x1183, // CL_PROGRAM_BUILD_LOG
                    0, ptr::null_mut(), &mut log_size,
                );
                let mut log = vec![0u8; log_size];
                clGetProgramBuildInfo(
                    program, self.device, 0x1183,
                    log_size, log.as_mut_ptr() as *mut c_void, ptr::null_mut(),
                );
                let log_str = String::from_utf8_lossy(&log);
                clReleaseProgram(program);
                bail!("clBuildProgram failed ({}): {}", r, log_str);
            }

            // Get binary size
            let mut binary_size: usize = 0;
            let r = clGetProgramInfo(
                program, CL_PROGRAM_BINARY_SIZES,
                std::mem::size_of::<usize>(), &mut binary_size as *mut usize as *mut c_void,
                ptr::null_mut(),
            );
            if r != CL_SUCCESS || binary_size == 0 {
                clReleaseProgram(program);
                bail!("Failed to get program binary size: {}", r);
            }

            // Get binary
            let mut binary = vec![0u8; binary_size];
            let mut binary_ptr = binary.as_mut_ptr();
            let r = clGetProgramInfo(
                program, CL_PROGRAM_BINARIES,
                std::mem::size_of::<*mut u8>(), &mut binary_ptr as *mut *mut u8 as *mut c_void,
                ptr::null_mut(),
            );
            if r != CL_SUCCESS {
                clReleaseProgram(program);
                bail!("Failed to get program binary: {}", r);
            }

            clReleaseProgram(program);
            Ok(binary)
        }
    }
}

impl Drop for OclCompiler {
    fn drop(&mut self) {
        unsafe {
            clReleaseContext(self.context);
        }
    }
}
