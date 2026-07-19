//! Level Zero device discovery and context management.
//!
//! Discovers the Intel integrated GPU via L0 driver enumeration,
//! creates a context and command queue for kernel submission.

use super::sys;
use anyhow::{bail, Context, Result};
use std::ptr;

/// Represents a discovered Level Zero GPU device with its properties.
#[derive(Debug)]
pub struct L0Device {
    pub handle: sys::ze_device_handle_t,
    pub name: String,
    pub vendor_id: u32,
    pub device_id: u32,
    pub max_mem_alloc_size: u64,
    pub num_slices: u32,
    pub num_subslices_per_slice: u32,
    pub num_eus_per_subslice: u32,
}

/// A Level Zero context bound to a specific device, with command queue and fence.
pub struct L0Context {
    pub device: L0Device,
    pub driver: sys::ze_driver_handle_t,
    pub context: sys::ze_context_handle_t,
    pub queue: sys::ze_command_queue_handle_t,
    pub fence: sys::ze_fence_handle_t,
}

impl L0Context {
    /// Discover the Intel integrated GPU and create a context with command queue.
    ///
    /// Prefers integrated GPU (Intel UHD/Iris). Falls back to first available GPU.
    pub fn new() -> Result<Self> {
        super::l0_init()?;

        // Enumerate drivers
        let mut driver_count: u32 = 0;
        let r = unsafe { sys::zeDriverGet(&mut driver_count, ptr::null_mut()) };
        if r != 0 || driver_count == 0 {
            bail!("No Level Zero drivers found (result=0x{:08x}, count={})", r, driver_count);
        }

        let mut drivers = vec![ptr::null_mut(); driver_count as usize];
        let r = unsafe { sys::zeDriverGet(&mut driver_count, drivers.as_mut_ptr()) };
        if r != 0 {
            bail!("zeDriverGet failed: 0x{:08x}", r);
        }

        // Find integrated GPU across all drivers
        let mut best_device: Option<(sys::ze_driver_handle_t, L0Device)> = None;

        for &driver in &drivers {
            let mut dev_count: u32 = 0;
            let r = unsafe { sys::zeDeviceGet(driver, &mut dev_count, ptr::null_mut()) };
            if r != 0 || dev_count == 0 {
                continue;
            }

            let mut devices = vec![ptr::null_mut(); dev_count as usize];
            let r = unsafe { sys::zeDeviceGet(driver, &mut dev_count, devices.as_mut_ptr()) };
            if r != 0 {
                continue;
            }

            for &device in &devices {
                let mut props = unsafe { std::mem::zeroed::<sys::ze_device_properties_t>() };
                props.stype = sys::ZE_STRUCTURE_TYPE_DEVICE_PROPERTIES;
                let r = unsafe { sys::zeDeviceGetProperties(device, &mut props) };
                if r != 0 {
                    continue;
                }

                // Only GPUs
                if props.r#type != sys::ZE_DEVICE_TYPE_GPU {
                    continue;
                }

                let name = {
                    let bytes = &props.name;
                    let len = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
                    String::from_utf8_lossy(&bytes[..len]).to_string()
                };

                let dev = L0Device {
                    handle: device,
                    name: name.clone(),
                    vendor_id: props.vendorId,
                    device_id: props.deviceId,
                    max_mem_alloc_size: props.maxMemAllocSize,
                    num_slices: props.numSlices,
                    num_subslices_per_slice: props.numSubslicesPerSlice,
                    num_eus_per_subslice: props.numEUsPerSubslice,
                };

                tracing::info!(
                    "L0 device: {} (vendor=0x{:04x}, id=0x{:04x}, EUs={})",
                    dev.name, dev.vendor_id, dev.device_id,
                    dev.num_slices * dev.num_subslices_per_slice * dev.num_eus_per_subslice
                );

                // Intel vendor ID = 0x8086
                let is_intel = props.vendorId == 0x8086;
                // Integrated GPUs typically have lower device IDs and "UHD" or "Iris" in name
                let is_integrated = name.contains("UHD") || name.contains("Iris") || name.contains("HD Graphics");

                match &best_device {
                    None => best_device = Some((driver, dev)),
                    Some((_, existing)) => {
                        // Prefer Intel integrated over anything else
                        if is_intel && is_integrated && !existing.name.contains("UHD") {
                            best_device = Some((driver, dev));
                        }
                    }
                }
            }
        }

        let (driver, device) = best_device.context("No GPU device found via Level Zero")?;

        tracing::info!("Selected L0 device: {}", device.name);

        // Create context
        let ctx_desc = sys::ze_context_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_CONTEXT_DESC,
            pNext: ptr::null(),
            flags: 0,
        };
        let mut context: sys::ze_context_handle_t = ptr::null_mut();
        let r = unsafe { sys::zeContextCreate(driver, &ctx_desc, &mut context) };
        if r != 0 {
            bail!("zeContextCreate failed: 0x{:08x}", r);
        }

        // Create command queue (ordinal 0 = compute)
        let queue_desc = sys::ze_command_queue_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_COMMAND_QUEUE_DESC,
            pNext: ptr::null(),
            ordinal: 0,
            index: 0,
            flags: 0,
            mode: sys::ZE_COMMAND_QUEUE_MODE_ASYNCHRONOUS,
            priority: sys::ZE_COMMAND_QUEUE_PRIORITY_NORMAL,
        };
        let mut queue: sys::ze_command_queue_handle_t = ptr::null_mut();
        let r = unsafe { sys::zeCommandQueueCreate(context, device.handle, &queue_desc, &mut queue) };
        if r != 0 {
            unsafe { sys::zeContextDestroy(context) };
            bail!("zeCommandQueueCreate failed: 0x{:08x}", r);
        }

        // Create a reusable fence for synchronization
        let fence_desc = sys::ze_fence_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_FENCE_DESC,
            pNext: ptr::null(),
            flags: 0,
        };
        let mut fence: sys::ze_fence_handle_t = ptr::null_mut();
        let r = unsafe { sys::zeFenceCreate(queue, &fence_desc, &mut fence) };
        if r != 0 {
            unsafe {
                sys::zeCommandQueueDestroy(queue);
                sys::zeContextDestroy(context);
            }
            bail!("zeFenceCreate failed: 0x{:08x}", r);
        }

        Ok(L0Context {
            device,
            driver,
            context,
            queue,
            fence,
        })
    }

    /// Execute a command list and wait for completion.
    pub fn submit_and_sync(&self, cmd_list: sys::ze_command_list_handle_t) -> Result<()> {
        // Reset fence from prior use
        unsafe { sys::zeFenceReset(self.fence) };

        let r = unsafe {
            sys::zeCommandQueueExecuteCommandLists(
                self.queue,
                1,
                &cmd_list,
                self.fence,
            )
        };
        if r != 0 {
            bail!("zeCommandQueueExecuteCommandLists failed: 0x{:08x}", r);
        }

        // Wait with 10 second timeout (u64::MAX = infinite, but we want a safety net)
        let r = unsafe { sys::zeFenceHostSynchronize(self.fence, 10_000_000_000) };
        if r != 0 {
            bail!("zeFenceHostSynchronize failed: 0x{:08x}", r);
        }

        Ok(())
    }

    /// Create a new command list for recording commands.
    pub fn create_command_list(&self) -> Result<sys::ze_command_list_handle_t> {
        let desc = sys::ze_command_list_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_COMMAND_LIST_DESC,
            pNext: ptr::null(),
            commandQueueGroupOrdinal: 0,
            flags: 0,
        };
        let mut list: sys::ze_command_list_handle_t = ptr::null_mut();
        let r = unsafe {
            sys::zeCommandListCreate(self.context, self.device.handle, &desc, &mut list)
        };
        if r != 0 {
            bail!("zeCommandListCreate failed: 0x{:08x}", r);
        }
        Ok(list)
    }
}

impl Drop for L0Context {
    fn drop(&mut self) {
        unsafe {
            sys::zeFenceDestroy(self.fence);
            sys::zeCommandQueueDestroy(self.queue);
            sys::zeContextDestroy(self.context);
        }
    }
}
