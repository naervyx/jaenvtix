# Filesystem Layout — Known Limitations

- **No concurrent locking**: Directory creation and cleanup are not synchronized across processes. Running multiple provisioning tasks simultaneously can lead to race conditions when wiping the shared `temp` directory.
- **Limited permission handling**: Failures other than `ENOENT`, `EEXIST`, or `EACCES` bubble up as generic errors. The module does not attempt to recover from read-only volumes or partially removed folders.
- **Home directory assumptions**: Defaults rely on `os.homedir()` and assume the `.m2` directory lives directly under it. Custom Maven locations must be configured via options before calling these helpers.
