INSERT INTO "marketing_users"
  (id, email, password, "firstName", "lastName", role, status, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'ai-research@system.local',
  '$2a$12$Bc.218ipfmw/Nyli4L8xLea9/4JZdDVgDjf2dIkdiJGw58P1sJ.Um',
  'AI', 'Research',
  'SALES_MANAGER', 'ACTIVE',
  NOW(), NOW()
)
ON CONFLICT (email) DO NOTHING;
