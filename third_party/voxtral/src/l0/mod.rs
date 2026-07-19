//! Intel Level Zero (L0) backend for iGPU decode path.
//!
//! This module provides a low-level GPU interface that bypasses wgpu's staging buffer
//! abstraction, enabling true zero-copy Unified Shared Memory (USM) on Intel UMA hardware.
//!
//! # Architecture
//!
//! ```text
//! ┌──────────────────────────────────────────────────────────┐
//! │  Shared DRAM (Intel UMA)                                  │
//! │  ┌───────────────────────────────────────────────────────┐│
//! │  │  USM Allocation (zeMemAllocShared)                    ││
//! │  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ ││
//! │  │  │ KV Cache K   │  │ KV Cache V   │  │ Scratch buf  │ ││
//! │  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ ││
//! │  │         │                  │                  │         ││
//! │  │    CPU: VHT2          CPU: VHT2         GPU: Q4       ││
//! │  │    compress/          compress/          matmul        ││
//! │  │    decompress         decompress         kernel       ││
//! │  └───────────────────────────────────────────────────────┘│
//! └──────────────────────────────────────────────────────────┘
//! ```
//!
//! The key insight: on UMA (Unified Memory Architecture), CPU and GPU share the same
//! physical DRAM. Level Zero's `zeMemAllocShared` returns a single pointer that both
//! CPU code (VHT2 transform) and GPU kernels (Q4 attention) can access without any
//! copy, staging buffer, or fence synchronization beyond the kernel itself.
//!
//! # Modules
//!
//! - [`device`] — L0 driver/device discovery and context creation
//! - [`usm`] — Unified Shared Memory allocator
//! - [`kernel`] — SPIR-V module loading and compute kernel dispatch

#[allow(non_snake_case)]
pub mod ocl_compile;

pub mod decode;
pub mod device;
pub mod kernel;
pub mod q4_decoder;
pub mod spirv_gen;
pub mod usm;

pub use decode::{L0DecodeConfig, L0DecodeContext};
pub use device::{L0Context, L0Device};
pub use kernel::{L0Kernel, L0Module};
pub use ocl_compile::OclCompiler;
pub use q4_decoder::{DecoderConfig, L0Decoder, Q4DecoderWeights, Q4LayerWeights};
pub use usm::{UsmAllocation, UsmAllocator};

use std::sync::Once;

static L0_INIT: Once = Once::new();
static mut L0_INIT_RESULT: i32 = -1;

/// Initialize the Level Zero runtime. Safe to call multiple times (idempotent).
/// Returns `Ok(())` if ze_loader.dll is present and zeInit succeeds.
pub fn l0_init() -> anyhow::Result<()> {
    L0_INIT.call_once(|| {
        unsafe {
            L0_INIT_RESULT = sys::zeInit(sys::ZE_INIT_FLAG_GPU_ONLY);
        }
    });
    let result = unsafe { L0_INIT_RESULT };
    if result == 0 {
        Ok(())
    } else {
        anyhow::bail!("zeInit failed with status 0x{:08x}", result)
    }
}

/// Raw FFI bindings to Level Zero API via ze_loader.dll
pub(crate) mod sys {
    #![allow(non_camel_case_types, non_snake_case, dead_code)]

    use std::ffi::c_void;

    // --- Types ---
    pub type ze_result_t = i32;
    pub type ze_driver_handle_t = *mut c_void;
    pub type ze_device_handle_t = *mut c_void;
    pub type ze_context_handle_t = *mut c_void;
    pub type ze_command_queue_handle_t = *mut c_void;
    pub type ze_command_list_handle_t = *mut c_void;
    pub type ze_module_handle_t = *mut c_void;
    pub type ze_kernel_handle_t = *mut c_void;
    pub type ze_event_pool_handle_t = *mut c_void;
    pub type ze_event_handle_t = *mut c_void;
    pub type ze_fence_handle_t = *mut c_void;

    // --- Constants ---
    pub const ZE_INIT_FLAG_GPU_ONLY: i32 = 0x01;
    pub const ZE_RESULT_SUCCESS: ze_result_t = 0;

    pub const ZE_DEVICE_TYPE_GPU: i32 = 1;
    pub const ZE_DEVICE_TYPE_CPU: i32 = 2;

    pub const ZE_MEMORY_TYPE_HOST: i32 = 0x1;
    pub const ZE_MEMORY_TYPE_DEVICE: i32 = 0x2;
    pub const ZE_MEMORY_TYPE_SHARED: i32 = 0x3;

    pub const ZE_MODULE_FORMAT_IL_SPIRV: i32 = 0;
    pub const ZE_MODULE_FORMAT_NATIVE: i32 = 1;

    pub const ZE_COMMAND_QUEUE_MODE_ASYNCHRONOUS: i32 = 1;
    pub const ZE_COMMAND_QUEUE_PRIORITY_NORMAL: i32 = 0;

    pub const ZE_EVENT_POOL_FLAG_HOST_VISIBLE: u32 = 0x01;
    pub const ZE_EVENT_SCOPE_FLAG_HOST: u32 = 0x01;

    // --- Descriptor structs ---
    #[repr(C)]
    pub struct ze_context_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub flags: u32,
    }

    #[repr(C)]
    pub struct ze_command_queue_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub ordinal: u32,
        pub index: u32,
        pub flags: u32,
        pub mode: i32,
        pub priority: i32,
    }

    #[repr(C)]
    pub struct ze_command_list_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub commandQueueGroupOrdinal: u32,
        pub flags: u32,
    }

    #[repr(C)]
    pub struct ze_device_mem_alloc_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub flags: u32,
        pub ordinal: u32,
    }

    #[repr(C)]
    pub struct ze_host_mem_alloc_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub flags: u32,
    }

    #[repr(C)]
    pub struct ze_module_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub format: i32,
        pub inputSize: usize,
        pub pInputModule: *const u8,
        pub pBuildFlags: *const i8,
        pub pConstants: *const c_void,
    }

    #[repr(C)]
    pub struct ze_kernel_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub flags: u32,
        pub pKernelName: *const i8,
    }

    #[repr(C)]
    pub struct ze_group_count_t {
        pub groupCountX: u32,
        pub groupCountY: u32,
        pub groupCountZ: u32,
    }

    #[repr(C)]
    pub struct ze_device_properties_t {
        pub stype: u32,
        pub pNext: *mut c_void,
        pub r#type: i32,
        pub vendorId: u32,
        pub deviceId: u32,
        pub flags: u32,
        pub subdeviceId: u32,
        pub coreClockRate: u32,
        pub maxMemAllocSize: u64,
        pub maxHardwareContexts: u32,
        pub maxCommandQueuePriority: u32,
        pub numThreadsPerEU: u32,
        pub physicalEUSimdWidth: u32,
        pub numEUsPerSubslice: u32,
        pub numSubslicesPerSlice: u32,
        pub numSlices: u32,
        pub timerResolution: u64,
        pub timestampValidBits: u32,
        pub kernelTimestampValidBits: u32,
        pub uuid: [u8; 16],
        pub name: [u8; 256],
    }

    #[repr(C)]
    pub struct ze_event_pool_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub flags: u32,
        pub count: u32,
    }

    #[repr(C)]
    pub struct ze_event_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub index: u32,
        pub signal: u32,
        pub wait: u32,
    }

    #[repr(C)]
    pub struct ze_fence_desc_t {
        pub stype: u32,
        pub pNext: *const c_void,
        pub flags: u32,
    }

    // --- Structure type enum values ---
    pub const ZE_STRUCTURE_TYPE_CONTEXT_DESC: u32 = 0x1;
    pub const ZE_STRUCTURE_TYPE_COMMAND_QUEUE_DESC: u32 = 0x2;
    pub const ZE_STRUCTURE_TYPE_COMMAND_LIST_DESC: u32 = 0x4;
    pub const ZE_STRUCTURE_TYPE_EVENT_POOL_DESC: u32 = 0x7;
    pub const ZE_STRUCTURE_TYPE_EVENT_DESC: u32 = 0x8;
    pub const ZE_STRUCTURE_TYPE_FENCE_DESC: u32 = 0xA;
    pub const ZE_STRUCTURE_TYPE_DEVICE_MEM_ALLOC_DESC: u32 = 0x14;
    pub const ZE_STRUCTURE_TYPE_HOST_MEM_ALLOC_DESC: u32 = 0x15;
    pub const ZE_STRUCTURE_TYPE_MODULE_DESC: u32 = 0x18;
    pub const ZE_STRUCTURE_TYPE_KERNEL_DESC: u32 = 0x1C;
    pub const ZE_STRUCTURE_TYPE_DEVICE_PROPERTIES: u32 = 0x3;

    // --- Dynamic linking ---
    use std::sync::OnceLock;

    static LIB: OnceLock<libloading::Library> = OnceLock::new();

    fn lib() -> &'static libloading::Library {
        LIB.get_or_init(|| unsafe {
            libloading::Library::new("ze_loader.dll")
                .expect("Failed to load ze_loader.dll — is Intel GPU driver installed?")
        })
    }

    macro_rules! l0_fn {
        ($name:ident ( $($arg:ident : $ty:ty),* ) -> $ret:ty) => {
            pub unsafe fn $name($($arg: $ty),*) -> $ret {
                let f: libloading::Symbol<unsafe extern "C" fn($($ty),*) -> $ret> =
                    lib().get(stringify!($name).as_bytes()).unwrap();
                f($($arg),*)
            }
        };
    }

    l0_fn!(zeInit(flags: i32) -> ze_result_t);
    l0_fn!(zeDriverGet(count: *mut u32, drivers: *mut ze_driver_handle_t) -> ze_result_t);
    l0_fn!(zeDeviceGet(driver: ze_driver_handle_t, count: *mut u32, devices: *mut ze_device_handle_t) -> ze_result_t);
    l0_fn!(zeDeviceGetProperties(device: ze_device_handle_t, props: *mut ze_device_properties_t) -> ze_result_t);
    l0_fn!(zeContextCreate(driver: ze_driver_handle_t, desc: *const ze_context_desc_t, context: *mut ze_context_handle_t) -> ze_result_t);
    l0_fn!(zeContextDestroy(context: ze_context_handle_t) -> ze_result_t);
    l0_fn!(zeCommandQueueCreate(context: ze_context_handle_t, device: ze_device_handle_t, desc: *const ze_command_queue_desc_t, queue: *mut ze_command_queue_handle_t) -> ze_result_t);
    l0_fn!(zeCommandQueueDestroy(queue: ze_command_queue_handle_t) -> ze_result_t);
    l0_fn!(zeCommandQueueExecuteCommandLists(queue: ze_command_queue_handle_t, numLists: u32, lists: *const ze_command_list_handle_t, fence: ze_fence_handle_t) -> ze_result_t);
    l0_fn!(zeCommandQueueSynchronize(queue: ze_command_queue_handle_t, timeout: u64) -> ze_result_t);
    l0_fn!(zeCommandListCreate(context: ze_context_handle_t, device: ze_device_handle_t, desc: *const ze_command_list_desc_t, list: *mut ze_command_list_handle_t) -> ze_result_t);
    l0_fn!(zeCommandListDestroy(list: ze_command_list_handle_t) -> ze_result_t);
    l0_fn!(zeCommandListClose(list: ze_command_list_handle_t) -> ze_result_t);
    l0_fn!(zeCommandListReset(list: ze_command_list_handle_t) -> ze_result_t);
    l0_fn!(zeCommandListAppendLaunchKernel(list: ze_command_list_handle_t, kernel: ze_kernel_handle_t, group_count: *const ze_group_count_t, signal_event: ze_event_handle_t, num_wait: u32, wait_events: *const ze_event_handle_t) -> ze_result_t);
    l0_fn!(zeCommandListAppendBarrier(list: ze_command_list_handle_t, signal_event: ze_event_handle_t, num_wait: u32, wait_events: *const ze_event_handle_t) -> ze_result_t);
    l0_fn!(zeMemAllocShared(context: ze_context_handle_t, device_desc: *const ze_device_mem_alloc_desc_t, host_desc: *const ze_host_mem_alloc_desc_t, size: usize, alignment: usize, device: ze_device_handle_t, ptr: *mut *mut c_void) -> ze_result_t);
    l0_fn!(zeMemAllocDevice(context: ze_context_handle_t, desc: *const ze_device_mem_alloc_desc_t, size: usize, alignment: usize, device: ze_device_handle_t, ptr: *mut *mut c_void) -> ze_result_t);
    l0_fn!(zeMemAllocHost(context: ze_context_handle_t, desc: *const ze_host_mem_alloc_desc_t, size: usize, alignment: usize, ptr: *mut *mut c_void) -> ze_result_t);
    l0_fn!(zeMemFree(context: ze_context_handle_t, ptr: *mut c_void) -> ze_result_t);
    l0_fn!(zeModuleCreate(context: ze_context_handle_t, device: ze_device_handle_t, desc: *const ze_module_desc_t, module: *mut ze_module_handle_t, build_log: *mut *mut c_void) -> ze_result_t);
    l0_fn!(zeModuleDestroy(module: ze_module_handle_t) -> ze_result_t);
    l0_fn!(zeKernelCreate(module: ze_module_handle_t, desc: *const ze_kernel_desc_t, kernel: *mut ze_kernel_handle_t) -> ze_result_t);
    l0_fn!(zeKernelDestroy(kernel: ze_kernel_handle_t) -> ze_result_t);
    l0_fn!(zeKernelSetGroupSize(kernel: ze_kernel_handle_t, x: u32, y: u32, z: u32) -> ze_result_t);
    l0_fn!(zeKernelSetArgumentValue(kernel: ze_kernel_handle_t, index: u32, size: usize, value: *const c_void) -> ze_result_t);
    l0_fn!(zeFenceCreate(queue: ze_command_queue_handle_t, desc: *const ze_fence_desc_t, fence: *mut ze_fence_handle_t) -> ze_result_t);
    l0_fn!(zeFenceDestroy(fence: ze_fence_handle_t) -> ze_result_t);
    l0_fn!(zeFenceHostSynchronize(fence: ze_fence_handle_t, timeout: u64) -> ze_result_t);
    l0_fn!(zeFenceReset(fence: ze_fence_handle_t) -> ze_result_t);
}
