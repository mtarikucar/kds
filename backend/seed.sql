-- Seed data for Restaurant POS

-- Create tenant
INSERT INTO tenants (id, name, subdomain, plan, status, "createdAt", "updatedAt")
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'Demo Restaurant', 'demo', 'PREMIUM', 'ACTIVE', NOW(), NOW());

-- Create users (password: password123, hashed with bcrypt rounds=10)
INSERT INTO users (id, email, password, "firstName", "lastName", role, status, "tenantId", "createdAt", "updatedAt")
VALUES
  ('550e8400-e29b-41d4-a716-446655440001', 'admin@restaurant.com', '$2b$10$qVUi8Nh27M2tOUOCHQpVgelGmn66ZlH7u3gd9AVumwezQMwIAOKoi', 'John', 'Admin', 'ADMIN', 'ACTIVE', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('550e8400-e29b-41d4-a716-446655440002', 'waiter@restaurant.com', '$2b$10$qVUi8Nh27M2tOUOCHQpVgelGmn66ZlH7u3gd9AVumwezQMwIAOKoi', 'Jane', 'Waiter', 'WAITER', 'ACTIVE', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('550e8400-e29b-41d4-a716-446655440003', 'kitchen@restaurant.com', '$2b$10$qVUi8Nh27M2tOUOCHQpVgelGmn66ZlH7u3gd9AVumwezQMwIAOKoi', 'Mike', 'Chef', 'KITCHEN', 'ACTIVE', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW());

-- Create categories
INSERT INTO categories (id, name, description, "displayOrder", "isActive", "tenantId", "createdAt", "updatedAt")
VALUES
  ('650e8400-e29b-41d4-a716-446655440001', 'Appetizers', 'Start your meal with our delicious starters', 1, true, '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('650e8400-e29b-41d4-a716-446655440002', 'Main Courses', 'Our signature main dishes', 2, true, '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('650e8400-e29b-41d4-a716-446655440003', 'Desserts', 'Sweet endings to your meal', 3, true, '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('650e8400-e29b-41d4-a716-446655440004', 'Beverages', 'Refreshing drinks', 4, true, '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW());

-- Create products
INSERT INTO products (id, name, description, price, "isAvailable", "stockTracked", "currentStock", "categoryId", "tenantId", "createdAt", "updatedAt")
VALUES
  ('750e8400-e29b-41d4-a716-446655440001', 'Caesar Salad', 'Fresh romaine lettuce with Caesar dressing', 8.99, true, true, 50, '650e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('750e8400-e29b-41d4-a716-446655440002', 'Garlic Bread', 'Toasted bread with garlic butter', 5.99, true, true, 30, '650e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('750e8400-e29b-41d4-a716-446655440003', 'Beef Burger', 'Premium beef patty with cheese and fries', 15.99, true, true, 40, '650e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('750e8400-e29b-41d4-a716-446655440004', 'Pasta Carbonara', 'Classic Italian pasta with creamy sauce', 16.99, true, true, 35, '650e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('750e8400-e29b-41d4-a716-446655440005', 'Chocolate Cake', 'Warm chocolate cake with molten center', 7.99, true, true, 22, '650e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('750e8400-e29b-41d4-a716-446655440006', 'Coca Cola', 'Refreshing soft drink', 2.99, true, true, 100, '650e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('750e8400-e29b-41d4-a716-446655440007', 'Coffee', 'Freshly brewed coffee', 3.99, true, false, 0, '650e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW());

-- Create tables
INSERT INTO tables (id, number, capacity, section, status, "tenantId", "createdAt", "updatedAt")
VALUES
  ('850e8400-e29b-41d4-a716-446655440001', '1', 2, 'Main Hall', 'AVAILABLE', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('850e8400-e29b-41d4-a716-446655440002', '2', 4, 'Main Hall', 'AVAILABLE', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('850e8400-e29b-41d4-a716-446655440003', '3', 4, 'Main Hall', 'AVAILABLE', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('850e8400-e29b-41d4-a716-446655440004', '4', 6, 'Main Hall', 'AVAILABLE', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW()),
  ('850e8400-e29b-41d4-a716-446655440005', '5', 2, 'Terrace', 'AVAILABLE', '550e8400-e29b-41d4-a716-446655440000', NOW(), NOW());
