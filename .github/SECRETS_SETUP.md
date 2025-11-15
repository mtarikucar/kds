# GitHub Secrets Setup Guide

This guide explains how to properly set up GitHub Secrets for CI/CD workflows.

## Required Secrets

### 1. SSH_PRIVATE_KEY_BASE64

The SSH private key encoded in base64 to avoid newline issues.

**How to get the key:**
```bash
cat ~/.ssh/id_ed25519 | base64 -w 0
```

**Format:** Copy the ENTIRE base64 string (it will be one long line):
```
LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTn...
```

**Important:**
- This is a base64-encoded version of your SSH private key
- It should be ONE LONG LINE without spaces or newlines
- Copy the entire output from the command above
- Do NOT add any extra characters

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

### "Load key error in libcrypto" or "is not a key file"

This means the SSH_PRIVATE_KEY_BASE64 secret is not correctly set. Make sure:
- You used the base64-encoded version (`cat ~/.ssh/id_ed25519 | base64 -w 0`)
- You copied the ENTIRE base64 string (one long line)
- No extra spaces or newlines were added

### "Permission denied (publickey)"

This means the public key is not on the server. To fix:

**On the production server (38.242.233.166):**
```bash
# Get your public key
cat ~/.ssh/id_ed25519.pub

# Add it to authorized_keys
mkdir -p ~/.ssh
chmod 700 ~/.ssh
cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Or from your local machine:
```bash
ssh-copy-id -i ~/.ssh/id_ed25519 root@38.242.233.166
```

### "Host key verification failed"

This means the SSH_KNOWN_HOSTS is not set correctly. Run:
```bash
ssh-keyscan -H 38.242.233.166
```

And update the secret with the new output.
