fn main() {
    // Stable Rust does not make migrate! observe newly added migration files.
    println!("cargo:rerun-if-changed=db/migrations");
}
