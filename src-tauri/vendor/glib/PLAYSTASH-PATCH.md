# PlayStash security backport

This directory contains the published `glib` 0.18.5 crate, with its original
license, copyright and authors. GTK3/Tauri still requires the 0.18 ABI.

The only library-code change is the upstream safety fix in
`src/variant_iter.rs::VariantStrIter::impl_get`: declare the C output pointer
mutable and pass `&mut p` to `g_variant_get_child` instead of `&p`.

- [RustSec RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
- [Upstream fix and review](https://github.com/gtk-rs/gtk-rs-core/pull/1343)
- [Original crate](https://crates.io/crates/glib/0.18.5)

The package version stays 0.18.5: this is a source backport, not an upstream
release. The repository-level Cargo patch applies to every GTK3 consumer.
Lockfile scanners cannot verify local crate source; the optimized iterator
regression test verifies this backport separately. No RustSec entry is ignored.
Remove this patch once Tauri and its GTK stack can use upstream glib >=0.20.
