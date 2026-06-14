import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useForm, FormProvider } from 'react-hook-form';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from './form';

function FieldHarness({
  withError,
}: {
  withError?: boolean;
}) {
  const methods = useForm<{ email: string }>({
    defaultValues: { email: '' },
  });

  // Inject an error so the error-driven branches of the form primitives run.
  if (withError) {
    methods.formState.errors.email = {
      type: 'required',
      message: 'Email is required',
    } as any;
  }

  return (
    <FormProvider {...methods}>
      <Form>
        <FormField
          name="email"
          control={methods.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <input aria-label="email-input" {...field} />
              </FormControl>
              <FormDescription>We never share it</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    </FormProvider>
  );
}

describe('form primitives', () => {
  it('renders label, control and description', () => {
    render(<FieldHarness />);
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('email-input')).toBeInTheDocument();
    expect(screen.getByText('We never share it')).toBeInTheDocument();
  });

  it('associates the label with the control via htmlFor/id', () => {
    render(<FieldHarness />);
    const label = screen.getByText('Email') as HTMLLabelElement;
    const forId = label.getAttribute('for');
    expect(forId).toMatch(/-form-item$/);
    expect(document.getElementById(forId!)).not.toBeNull();
  });

  it('renders the error message and turns the label red', () => {
    render(<FieldHarness withError />);
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    const label = screen.getByText('Email') as HTMLLabelElement;
    expect(label.className).toContain('text-red-600');
  });

  it('renders no message element when there is no error and no children', () => {
    render(<FieldHarness />);
    expect(screen.queryByText('Email is required')).not.toBeInTheDocument();
  });
});
