import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  CardFooter,
} from './Card';

describe('Card', () => {
  it('renders the full composition with content', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description text</CardDescription>
        </CardHeader>
        <CardContent>Body content</CardContent>
        <CardFooter>Footer content</CardFooter>
      </Card>,
    );

    expect(
      screen.getByRole('heading', { name: 'Title' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Description text')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByText('Footer content')).toBeInTheDocument();
  });

  it('applies the elevated variant class', () => {
    render(
      <Card variant="elevated" data-testid="card">
        x
      </Card>,
    );
    expect(screen.getByTestId('card').className).toContain('hover:shadow-md');
  });

  it('applies the bordered variant class', () => {
    render(
      <Card variant="bordered" data-testid="card">
        x
      </Card>,
    );
    expect(screen.getByTestId('card').className).toContain('border-slate-200');
  });

  it('merges custom classNames onto the root', () => {
    render(
      <Card className="my-card" data-testid="card">
        x
      </Card>,
    );
    expect(screen.getByTestId('card').className).toContain('my-card');
  });
});
