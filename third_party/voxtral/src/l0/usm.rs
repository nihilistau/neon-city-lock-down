//! Unified Shared Memory (USM) allocator for zero-copy KV cache.
//!
//! USM allocations via `zeMemAllocShared` return a single `*mut f32` pointer that is
//! accessible by both CPU and GPU without any explicit copy or staging buffer.
//! On Intel UMA (iGPU shares system DRAM), this is literally the same physical memory —
//! no DMA, no PCIe transfer, no fence between CPU write and GPU read beyond cache coherence.
//!
//! # Usage for KV Cache
//!
//! ```text
//! let alloc = UsmAllocator::new(&ctx);
//! let kv = alloc.alloc_shared::<f32>(batch * heads * max_seq * head_dim)?;
//!
//! // CPU: VHT2 compress/decompress operates directly on kv.as_mut_slice()
//! compress_kv_vector(&mut kv.as_mut_slice()[offset..offset+128], &config);
//!
//! // GPU: Q4 attention kernel reads kv.ptr() as a buffer argument — zero copy!
//! kernel.set_arg(0, kv.ptr());
//! ```

use super::device::L0Context;
use super::sys;
use anyhow::{bail, Result};
use std::ffi::c_void;
use std::marker::PhantomData;
use std::ptr;

/// A USM shared-memory allocation that can be accessed by both CPU and GPU.
///
/// The pointer is valid until this struct is dropped.
pub struct UsmAllocation<T> {
    ptr: *mut c_void,
    len: usize, // number of T elements
    context: sys::ze_context_handle_t,
    _marker: PhantomData<T>,
}

// SAFETY: USM shared allocations are designed for cross-device access.
// The GPU can access the memory concurrently after a kernel launch,
// but we ensure synchronization via command queue fences.
unsafe impl<T: Send> Send for UsmAllocation<T> {}
unsafe impl<T: Sync> Sync for UsmAllocation<T> {}

impl<T> UsmAllocation<T> {
    /// Raw pointer to the allocation (for passing to L0 kernel arguments).
    pub fn ptr(&self) -> *mut T {
        self.ptr as *mut T
    }

    /// Number of elements of type T.
    pub fn len(&self) -> usize {
        self.len
    }

    /// Size in bytes.
    pub fn size_bytes(&self) -> usize {
        self.len * std::mem::size_of::<T>()
    }

    /// Get a mutable slice for CPU access (e.g., VHT2 operations).
    ///
    /// # Safety
    /// Caller must ensure no GPU kernel is concurrently accessing this memory.
    /// Call after fence synchronization.
    pub unsafe fn as_mut_slice(&self) -> &mut [T] {
        std::slice::from_raw_parts_mut(self.ptr as *mut T, self.len)
    }

    /// Get an immutable slice for CPU reads.
    ///
    /// # Safety
    /// Caller must ensure no GPU kernel is concurrently writing this memory.
    pub unsafe fn as_slice(&self) -> &[T] {
        std::slice::from_raw_parts(self.ptr as *const T, self.len)
    }

    /// Write data from a slice into the USM allocation at a given element offset.
    ///
    /// # Safety
    /// Caller must ensure no GPU kernel is concurrently accessing the written region.
    pub unsafe fn write_at(&self, offset: usize, data: &[T])
    where
        T: Copy,
    {
        debug_assert!(offset + data.len() <= self.len);
        let dst = (self.ptr as *mut T).add(offset);
        ptr::copy_nonoverlapping(data.as_ptr(), dst, data.len());
    }

    /// Read data from the USM allocation into a Vec.
    ///
    /// # Safety
    /// Caller must ensure no GPU kernel is concurrently writing this memory.
    pub unsafe fn read_to_vec(&self) -> Vec<T>
    where
        T: Copy + Default,
    {
        let mut out = vec![T::default(); self.len];
        ptr::copy_nonoverlapping(self.ptr as *const T, out.as_mut_ptr(), self.len);
        out
    }
}

impl<T> Drop for UsmAllocation<T> {
    fn drop(&mut self) {
        unsafe {
            sys::zeMemFree(self.context, self.ptr);
        }
    }
}

/// Allocator for USM memory tied to a specific L0 context and device.
pub struct UsmAllocator {
    context: sys::ze_context_handle_t,
    device: sys::ze_device_handle_t,
}

impl UsmAllocator {
    /// Create an allocator bound to an L0 context.
    pub fn new(ctx: &L0Context) -> Self {
        UsmAllocator {
            context: ctx.context,
            device: ctx.device.handle,
        }
    }

    /// Allocate shared memory accessible by both CPU and GPU.
    /// This is the key primitive for zero-copy KV cache.
    ///
    /// On Intel UMA, this is backed by the same physical DRAM pages —
    /// no copies between CPU VHT2 and GPU attention.
    pub fn alloc_shared<T>(&self, count: usize) -> Result<UsmAllocation<T>> {
        let size = count * std::mem::size_of::<T>();
        if size == 0 {
            bail!("Cannot allocate zero bytes");
        }

        let device_desc = sys::ze_device_mem_alloc_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_DEVICE_MEM_ALLOC_DESC,
            pNext: ptr::null(),
            flags: 0,
            ordinal: 0,
        };
        let host_desc = sys::ze_host_mem_alloc_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_HOST_MEM_ALLOC_DESC,
            pNext: ptr::null(),
            flags: 0,
        };

        let mut out_ptr: *mut c_void = ptr::null_mut();
        let alignment = std::mem::align_of::<T>().max(64); // 64-byte alignment for cache lines

        let r = unsafe {
            sys::zeMemAllocShared(
                self.context,
                &device_desc,
                &host_desc,
                size,
                alignment,
                self.device,
                &mut out_ptr,
            )
        };

        if r != 0 || out_ptr.is_null() {
            bail!(
                "zeMemAllocShared failed: result=0x{:08x}, size={} bytes",
                r, size
            );
        }

        // Zero-initialize for safety
        unsafe {
            ptr::write_bytes(out_ptr as *mut u8, 0, size);
        }

        Ok(UsmAllocation {
            ptr: out_ptr,
            len: count,
            context: self.context,
            _marker: PhantomData,
        })
    }

    /// Allocate device-only memory (for intermediate GPU buffers that don't need CPU access).
    pub fn alloc_device<T>(&self, count: usize) -> Result<UsmAllocation<T>> {
        let size = count * std::mem::size_of::<T>();
        if size == 0 {
            bail!("Cannot allocate zero bytes");
        }

        let desc = sys::ze_device_mem_alloc_desc_t {
            stype: sys::ZE_STRUCTURE_TYPE_DEVICE_MEM_ALLOC_DESC,
            pNext: ptr::null(),
            flags: 0,
            ordinal: 0,
        };

        let mut out_ptr: *mut c_void = ptr::null_mut();
        let alignment = std::mem::align_of::<T>().max(64);

        let r = unsafe {
            sys::zeMemAllocDevice(
                self.context,
                &desc,
                size,
                alignment,
                self.device,
                &mut out_ptr,
            )
        };

        if r != 0 || out_ptr.is_null() {
            bail!(
                "zeMemAllocDevice failed: result=0x{:08x}, size={} bytes",
                r, size
            );
        }

        Ok(UsmAllocation {
            ptr: out_ptr,
            len: count,
            context: self.context,
            _marker: PhantomData,
        })
    }
}

/// Pre-sized KV cache allocation for the decoder.
///
/// Dimensions: [batch, kv_heads, max_seq_len, head_dim]
/// For Voxtral decoder: [1, 8, 8192, 128] = 32 MiB per K and V = 64 MiB total
pub struct UsmKvCache {
    pub key: UsmAllocation<f32>,
    pub value: UsmAllocation<f32>,
    pub batch: usize,
    pub kv_heads: usize,
    pub max_seq_len: usize,
    pub head_dim: usize,
    pub current_len: usize,
}

impl UsmKvCache {
    /// Allocate KV cache buffers for the decoder.
    pub fn new(
        allocator: &UsmAllocator,
        batch: usize,
        kv_heads: usize,
        max_seq_len: usize,
        head_dim: usize,
    ) -> Result<Self> {
        let total_elements = batch * kv_heads * max_seq_len * head_dim;
        let size_mb = (total_elements * 4) as f64 / (1024.0 * 1024.0);
        tracing::info!(
            "Allocating USM KV cache: [{}, {}, {}, {}] = {:.1} MiB per buffer ({:.1} MiB total)",
            batch, kv_heads, max_seq_len, head_dim, size_mb, size_mb * 2.0
        );

        let key = allocator.alloc_shared::<f32>(total_elements)?;
        let value = allocator.alloc_shared::<f32>(total_elements)?;

        Ok(UsmKvCache {
            key,
            value,
            batch,
            kv_heads,
            max_seq_len,
            head_dim,
            current_len: 0,
        })
    }

    /// Get offset into the flat buffer for a specific position.
    /// Layout: [batch, heads, seq, head_dim] in row-major order.
    pub fn offset(&self, batch_idx: usize, head_idx: usize, seq_idx: usize) -> usize {
        ((batch_idx * self.kv_heads + head_idx) * self.max_seq_len + seq_idx) * self.head_dim
    }

    /// Write a new KV vector at the current sequence position.
    /// Called each decode step with the new key/value vectors.
    ///
    /// # Safety
    /// Must be called after GPU work on this cache has completed (post-fence).
    pub unsafe fn append_kv(
        &mut self,
        key_data: &[f32],   // [batch, kv_heads, 1, head_dim]
        value_data: &[f32], // [batch, kv_heads, 1, head_dim]
    ) {
        debug_assert_eq!(key_data.len(), self.batch * self.kv_heads * self.head_dim);
        debug_assert_eq!(value_data.len(), self.batch * self.kv_heads * self.head_dim);
        debug_assert!(self.current_len < self.max_seq_len);

        let seq_idx = self.current_len;
        for b in 0..self.batch {
            for h in 0..self.kv_heads {
                let src_offset = (b * self.kv_heads + h) * self.head_dim;
                let dst_offset = self.offset(b, h, seq_idx);
                self.key.write_at(dst_offset, &key_data[src_offset..src_offset + self.head_dim]);
                self.value.write_at(dst_offset, &value_data[src_offset..src_offset + self.head_dim]);
            }
        }

        self.current_len += 1;
    }

    /// Get a mutable slice of the key cache for VHT2 compression (CPU-side).
    ///
    /// # Safety
    /// Must be called after GPU work has completed.
    pub unsafe fn key_slice_mut(&self, batch_idx: usize, head_idx: usize, seq_idx: usize) -> &mut [f32] {
        let offset = self.offset(batch_idx, head_idx, seq_idx);
        let ptr = (self.key.ptr() as *mut f32).add(offset);
        std::slice::from_raw_parts_mut(ptr, self.head_dim)
    }

    /// Get a mutable slice of the value cache for VHT2 compression (CPU-side).
    ///
    /// # Safety
    /// Must be called after GPU work has completed.
    pub unsafe fn value_slice_mut(&self, batch_idx: usize, head_idx: usize, seq_idx: usize) -> &mut [f32] {
        let offset = self.offset(batch_idx, head_idx, seq_idx);
        let ptr = (self.value.ptr() as *mut f32).add(offset);
        std::slice::from_raw_parts_mut(ptr, self.head_dim)
    }

    /// Reset for a new sequence.
    pub fn reset(&mut self) {
        self.current_len = 0;
    }
}
