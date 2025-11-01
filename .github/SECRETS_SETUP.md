# GitHub Secrets Setup Guide

This guide explains how to properly set up GitHub Secrets for CI/CD workflows.

## Required Secrets

### 1. SSH_PRIVATE_KEY

The SSH private key used to connect to the production server.

**How to get the key:**
```bash
cat ~/.ssh/id_ed25519
```

**Format:** Copy the ENTIRE output including the header and footer:
```
-----BEGIN OPENSSH PRIVATE KEY-----
[key content here - multiple lines]
-----END OPENSSH PRIVATE KEY-----
```

**Important:**
- Include the BEGIN and END lines
- Include ALL lines of the key
- Do NOT add extra newlines at the beginning or end
- Copy as-is without modifications

### 2. SSH_KNOWN_HOSTS

The known hosts entry for the production server.

**How to get it:**
```bash
ssh-keyscan -H 38.242.233.166 2>/dev/null | grep -v '^#'
```

**Format:** Copy ALL output lines EXCEPT comment lines (lines starting with #). It should look like:
```
|1|hash1|hash2 ssh-ed25519 AAAA...
|1|hash3|hash4 ssh-rsa AAAA...
|1|hash5|hash6 ecdsa-sha2-nistp256 AAAA...
```

**IMPORTANT:**
- Include ONLY lines starting with `|1|`
- Do NOT include lines starting with `#` (comments)
- Usually 3 lines total (ed25519, rsa, ecdsa)
- Do NOT modify the hash values
- Each line must end with the key type and key data

**Wrong format (with comments):**
```
# 38.242.233.166:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.14  ← DON'T COPY THIS
|1|hash|hash ssh-ed25519 AAAA...  ← COPY THIS
```

**Correct format (without comments):**
```
|1|hash|hash ssh-ed25519 AAAA...  ← COPY ONLY THIS
|1|hash|hash ssh-rsa AAAA...
|1|hash|hash ecdsa-sha2-nistp256 AAAA...
```

### 3. STAGING_SERVER_HOST (Optional)

The hostname or IP address of the staging server.

Example: `staging.example.com` or `192.168.1.100`

### 4. STAGING_SERVER_USER (Optional)

The SSH user for the staging server.

Example: `deploy` or `root`

## How to Add Secrets to GitHub

1. Go to your repository on GitHub
2. Click on **Settings** tab
3. Click on **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Enter the secret name (e.g., `SSH_PRIVATE_KEY`)
6. Paste the secret value (following the format above)
7. Click **Add secret**

## Testing SSH Connection Locally

Before pushing, test your SSH connection:

```bash
# Test with the private key
ssh -i ~/.ssh/id_ed25519 root@38.242.233.166 "echo 'Connection successful'"
```

If this fails, the GitHub Actions will also fail.

## Troubleshooting

### "Load key error in libcrypto"

This means the SSH private key is not in the correct format. Make sure:
- You copied the ENTIRE key including headers
- No extra spaces or newlines were added
- The key is a valid OpenSSH private key

### "Permission denied (publickey)"

This means:
- The public key is not added to the server's `~/.ssh/authorized_keys`
- Or the private key doesn't match the public key on the server

To fix:
```bash
# On your local machine (where the private key is)
ssh-copy-id -i ~/.ssh/id_ed25519 root@38.242.233.166
```

### "Host key verification failed"

This means the SSH_KNOWN_HOSTS is not set correctly. Run:
```bash
ssh-keyscan -H 38.242.233.166
```

And update the secret with the new output.
