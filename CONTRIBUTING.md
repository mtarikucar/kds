# Contributing to Restaurant POS System

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)

---

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them get started
- Provide constructive feedback
- Focus on what is best for the community

---

## Getting Started

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- Git
- Code editor (VSCode recommended)

### Initial Setup

```bash
# 1. Fork the repository on GitHub

# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/kds.git
cd kds

# 3. Add upstream remote
git remote add upstream https://github.com/ORIGINAL_OWNER/kds.git

# 4. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 5. Setup environment
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 6. Start development environment
docker-compose up -d
cd backend && npx prisma migrate dev
cd backend && npx prisma db seed
```

---

## Development Workflow

### 1. Create a Feature Branch

```bash
# Update your main branch
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/issue-description
```

### 2. Make Changes

- Write clean, readable code
- Follow existing code patterns
- Add comments for complex logic
- Update tests if needed
- Update documentation if needed

### 3. Test Your Changes

```bash
# Backend tests
cd backend
npm run test
npm run lint

# Frontend tests
cd frontend
npm run lint
npm run build
```

### 4. Commit Your Changes

```bash
git add .
git commit -m "feat: add new feature description"
```

See [Commit Guidelines](#commit-guidelines) below.

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name

# Then create a Pull Request on GitHub
```

---

## Coding Standards

### TypeScript

- **Strict mode** enabled
- **No `any` types** - use proper typing
- **Interfaces over types** for objects
- **Enums** for constants with multiple values

**Good:**
```typescript
interface CreateOrderDto {
  type: OrderType;
  tableId: string;
  items: OrderItemDto[];
}

enum OrderType {
  DINE_IN = 'DINE_IN',
  TAKEAWAY = 'TAKEAWAY',
  DELIVERY = 'DELIVERY',
}
```

**Bad:**
```typescript
const createOrder = (data: any) => {
  // Don't use 'any'
}
```

### Backend (NestJS)

- **One controller per resource**
- **Services contain business logic**
- **DTOs for all request/response objects**
- **Validation with class-validator**
- **Swagger documentation on all endpoints**

**Example Controller:**
```typescript
@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all products' })
  @ApiResponse({ status: 200, type: [ProductDto] })
  async findAll(@Query() filters: FilterProductDto) {
    return this.productsService.findAll(filters);
  }
}
```

**Example Service:**
```typescript
@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: FilterProductDto) {
    return this.prisma.product.findMany({
      where: {
        tenantId: filters.tenantId,
        categoryId: filters.categoryId,
      },
      include: {
        category: true,
      },
    });
  }
}
```

### Frontend (React)

- **Functional components only** (no class components)
- **Custom hooks** for reusable logic
- **React Query** for server state
- **Zustand** for client state (minimal)
- **TypeScript interfaces** for all props

**Example Component:**
```typescript
interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onSelect
}) => {
  return (
    <Card onClick={() => onSelect(product)}>
      <h3>{product.name}</h3>
      <p>{formatCurrency(product.price)}</p>
    </Card>
  );
};
```

**Example Custom Hook:**
```typescript
export const useProducts = (categoryId?: string) => {
  return useQuery({
    queryKey: ['products', categoryId],
    queryFn: () => api.get('/products', { params: { categoryId } }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
```

### Styling (Tailwind CSS)

- **Use Tailwind utility classes**
- **Extract repeated patterns** into components
- **Mobile-first** responsive design

```typescript
// Good
<button className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded">
  Click Me
</button>

// Better - Extract to Button component
<Button variant="primary" onClick={handleClick}>
  Click Me
</Button>
```

### File Naming

- **Components:** PascalCase - `ProductCard.tsx`
- **Utilities:** camelCase - `formatCurrency.ts`
- **Hooks:** camelCase with 'use' prefix - `useProducts.ts`
- **Types:** PascalCase - `Product.ts`
- **Constants:** UPPER_SNAKE_CASE - `API_ENDPOINTS.ts`

---

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat:** New feature
- **fix:** Bug fix
- **docs:** Documentation changes
- **style:** Code style changes (formatting, no logic change)
- **refactor:** Code refactoring
- **test:** Adding or updating tests
- **chore:** Maintenance tasks

### Examples

```bash
feat(orders): add discount functionality to orders

- Add discount field to order DTO
- Update order calculation logic
- Add discount input to POS interface

Closes #123
```

```bash
fix(auth): resolve token refresh issue

The refresh token was not being properly validated
due to incorrect secret key usage.

Fixes #456
```

```bash
docs(readme): update installation instructions

Added Docker setup steps and clarified prerequisites.
```

### Rules

- ✅ Use present tense ("add feature" not "added feature")
- ✅ Keep subject line under 72 characters
- ✅ Reference issues in footer (`Closes #123`, `Fixes #456`)
- ✅ Be descriptive in the body for complex changes

---

## Pull Request Process

### Before Submitting

- [ ] Code compiles without errors
- [ ] All tests pass
- [ ] Linter passes
- [ ] Documentation updated (if needed)
- [ ] No merge conflicts with main branch

### PR Template

When creating a PR, include:

**Title:** Follow commit message format
```
feat(orders): add discount functionality
```

**Description:**
```markdown
## What
Brief description of what this PR does

## Why
Explain why this change is needed

## How
Explain how you implemented it

## Testing
How did you test this?

## Screenshots
(If applicable)

## Checklist
- [ ] Tests pass
- [ ] Linter passes
- [ ] Documentation updated
```

### Review Process

1. **Automated checks** run (CI/CD)
2. **Code review** by maintainers
3. **Address feedback** if any
4. **Approval** by at least one maintainer
5. **Merge** to main branch

### Getting Your PR Merged Faster

- ✅ Keep PRs small and focused
- ✅ Write clear descriptions
- ✅ Respond to feedback quickly
- ✅ Ensure all checks pass
- ✅ Update your branch if main changes

---

## Testing

### Backend Tests

```bash
cd backend

# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage report
npm run test:cov
```

**Example Test:**
```typescript
describe('ProductsService', () => {
  it('should create a product', async () => {
    const dto: CreateProductDto = {
      name: 'Test Product',
      price: 9.99,
      categoryId: 'uuid',
    };

    const result = await service.create(dto, 'tenant-id');

    expect(result.name).toBe(dto.name);
    expect(result.price).toBe(dto.price);
  });
});
```

### Frontend Tests

```bash
cd frontend

# Run tests (when implemented)
npm run test
```

**Example Test (future):**
```typescript
import { render, screen } from '@testing-library/react';
import { ProductCard } from './ProductCard';

test('renders product name and price', () => {
  const product = {
    id: '1',
    name: 'Test Product',
    price: 9.99,
  };

  render(<ProductCard product={product} onSelect={() => {}} />);

  expect(screen.getByText('Test Product')).toBeInTheDocument();
  expect(screen.getByText('$9.99')).toBeInTheDocument();
});
```

---

## Architecture Decisions

When making significant changes, consider:

1. **Multi-Tenancy** - All data must be tenant-isolated
2. **RBAC** - Respect role-based permissions
3. **Performance** - Use database indexes, caching when appropriate
4. **Security** - Validate all inputs, protect sensitive data
5. **Scalability** - Design for horizontal scaling

---

## Documentation

### When to Update Docs

- ✅ New features added
- ✅ API endpoints changed
- ✅ Configuration options added
- ✅ Breaking changes made
- ✅ Bug fixes that affect usage

### Where to Document

- **README.md** - Project overview, quick start
- **SETUP.md** - Detailed installation and configuration
- **API.md** - API reference
- **ARCHITECTURE.md** - System design and patterns
- **Code comments** - Complex logic explanation
- **Swagger/OpenAPI** - API endpoints (in code)

---

## Getting Help

- 📧 **Email:** support@yourproject.com
- 💬 **Discord:** Join our server
- 🐛 **Issues:** [GitHub Issues](https://github.com/yourproject/kds/issues)
- 📚 **Docs:** [Documentation](https://docs.yourproject.com)

---

## Recognition

Contributors will be recognized in:

- Contributors section of README
- Release notes
- Project website (if applicable)

Thank you for contributing! 🎉
