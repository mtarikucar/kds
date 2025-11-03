# Desktop App Release Setup Guide

This guide will help you set up the required GitHub Secrets for automated desktop app releases.

## Required GitHub Secrets

You need to add the following secrets to your GitHub repository:

**Go to:** `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

### 1. TAURI_PRIVATE_KEY (Required)

**Description:** Private key for signing updater packages

**Value:**
```
dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5ejJlZzFrNDFhK0kyUS9PcVJwdGJ1TnVHaGVDUEFCbitEOWRtWlZvNHNmNEFBQkFBQUFBQUFBQUFBQUlBQUFBQVREYU93S2w2YmVlNlN6RmRyWkVDc1NvdEN3RTU4a0IyWmpVZWhvWTgvY29NVnozWVFZNVRRMEVIbldqUHM3dWpSeWNONm1RTFA0TUlTbHFvNVlmaTRPaVFGTnZscER5NzJPbjV3Nm1GTEJQYXV1WHo5ZGxSZ1FMRVZGdUJ3ZW5mNWx1a1p4NzZKQlk9Cg==
```

⚠️ **IMPORTANT:** Keep this secret safe! If you lose it, you won't be able to sign future updates and auto-updates will break for existing users.

---

### 2. TAURI_KEY_PASSWORD (Optional)

**Description:** Password for the Tauri private key

**Value:** Leave empty (or don't create this secret)

**Note:** Our key was generated without a password. If you regenerate the key with a password in the future, add it here.

---

### 3. DESKTOP_RELEASE_API_KEY (Required)

**Description:** Static API key for authenticating GitHub Actions with the backend API

**Value:**
```
35e6700cc5d60cd9a3656e9a17c65f6b99360f87efd0cbdf1ffdc5e74ef7a6cc
```

**Note:** This is the same key configured in your backend `.env` file. It never expires and is independent of user sessions.

---

### 4. WINDOWS_CERTIFICATE (Optional but Recommended)

**Description:** Windows code signing certificate for signing MSI installers

**Why you need it:** Without a code signing certificate, Windows will show security warnings when users try to install your app.

**How to get a certificate:**

1. Purchase a code signing certificate from a Certificate Authority (CA) like:
   - DigiCert
   - Sectigo
   - GlobalSign

2. The certificate will be provided as a `.pfx` or `.p12` file

3. Convert it to base64:
   ```bash
   # On Linux/Mac:
   base64 -i your-certificate.pfx -o certificate.txt

   # On Windows (PowerShell):
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("your-certificate.pfx")) | Out-File certificate.txt
   ```

4. Copy the entire contents of `certificate.txt` as the secret value

**Note:** If you skip this, the workflow will still work but users will see "Unknown Publisher" warnings.

---

### 5. WINDOWS_CERTIFICATE_PASSWORD (Optional)

**Description:** Password for the Windows code signing certificate

**Value:** The password you used when creating the `.pfx` file

**Note:** Only required if you added `WINDOWS_CERTIFICATE` above.

---

## Verification Checklist

After adding the secrets, verify everything is set up:

- [ ] `TAURI_PRIVATE_KEY` is added
- [ ] `DESKTOP_RELEASE_API_KEY` is added
- [ ] (Optional) `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` are added
- [ ] Public key is in `frontend/src-tauri/tauri.conf.json` (already done ✓)
- [ ] Updater endpoint is configured in `tauri.conf.json` (already done ✓)
- [ ] API key is configured in backend `.env` file (already done ✓)

---

## Testing the Workflow

Once all secrets are added, test the workflow:

1. **Option A: Re-trigger existing tag**
   ```bash
   git tag -d v0.2.7
   git push origin :refs/tags/v0.2.7
   git tag v0.2.7
   git push origin v0.2.7
   ```

2. **Option B: Manual workflow dispatch**
   - Go to Actions tab on GitHub
   - Select "Desktop App Release" workflow
   - Click "Run workflow"
   - Enter tag name (e.g., v0.2.7)

3. **Monitor the workflow:**
   - Check if all build jobs complete successfully
   - Verify artifacts are uploaded to GitHub Release
   - Check if backend API has the new release
   - Test download URLs

---

## Troubleshooting

### Workflow fails with "Authentication failed" or "Invalid API key"

- Verify `DESKTOP_RELEASE_API_KEY` matches the key in backend `.env` file
- Check backend logs for authentication errors
- Ensure the API key guard is properly configured in the backend

### Windows signing fails

- Verify `WINDOWS_CERTIFICATE` is properly base64 encoded
- Check `WINDOWS_CERTIFICATE_PASSWORD` is correct
- Make sure the certificate is valid and not expired

### Updater endpoint returns 404

- Check backend API is deployed and running
- Verify the endpoint exists: `https://hummytummy.com/api/desktop/updates/windows-x86_64/0.2.6`
- Make sure the release is published in the backend

### Download URLs are broken

- Wait a few minutes after release creation (GitHub needs time to process assets)
- Check GitHub Release page manually to verify files exist
- Make sure file names match the expected pattern

---

## Security Best Practices

1. **Never commit secrets to git**
   - Keep `.env` files in `.gitignore`
   - Never hardcode tokens or keys

2. **Rotate tokens regularly**
   - Update `BACKEND_ADMIN_TOKEN` periodically
   - If `TAURI_PRIVATE_KEY` is compromised, you'll need to regenerate and update all existing apps

3. **Limit token permissions**
   - Backend admin token should only have desktop-release permissions if possible

4. **Use strong passwords**
   - Protect your certificate with a strong password
   - Use a password manager

---

## Getting Help

If you run into issues:

1. Check workflow logs in GitHub Actions tab
2. Review backend API logs on the server
3. Test endpoints manually with `curl`
4. Create an issue on the repository

---

**Last Updated:** 2025-11-03
**Generated by:** Claude Code
