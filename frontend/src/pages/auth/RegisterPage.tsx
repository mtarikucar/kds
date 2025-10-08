import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useRegister } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { UserRole } from '../../types';

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  restaurantName: z.string().min(1, 'Restaurant name is required'),
  role: z.nativeEnum(UserRole).optional(),
});

type RegisterFormData = z.infer<typeof registerSchema>;

const RegisterPage = () => {
  const navigate = useNavigate();
  const { mutate: register, isPending } = useRegister();

  const {
    register: registerField,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      role: UserRole.ADMIN,
    },
  });

  const onSubmit = (data: RegisterFormData) => {
    register(data, {
      onSuccess: () => {
        navigate('/login');
      },
    });
  };

  const roleOptions = [
    { value: UserRole.ADMIN, label: 'Admin' },
    { value: UserRole.MANAGER, label: 'Manager' },
    { value: UserRole.WAITER, label: 'Waiter' },
    { value: UserRole.CHEF, label: 'Chef' },
    { value: UserRole.CASHIER, label: 'Cashier' },
  ];

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl">
            Register Restaurant Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Email"
              type="email"
              placeholder="Enter your email"
              error={errors.email?.message}
              {...registerField('email')}
            />

            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              error={errors.password?.message}
              {...registerField('password')}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="First Name"
                placeholder="First name"
                error={errors.firstName?.message}
                {...registerField('firstName')}
              />

              <Input
                label="Last Name"
                placeholder="Last name"
                error={errors.lastName?.message}
                {...registerField('lastName')}
              />
            </div>

            <Input
              label="Restaurant Name"
              placeholder="Enter restaurant name"
              error={errors.restaurantName?.message}
              {...registerField('restaurantName')}
            />

            <Select
              label="Role"
              options={roleOptions}
              error={errors.role?.message}
              {...registerField('role')}
            />

            <Button
              type="submit"
              className="w-full"
              isLoading={isPending}
            >
              Register
            </Button>

            <div className="text-center text-sm text-gray-600">
              Already have an account?{' '}
              <Link
                to="/login"
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Login here
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default RegisterPage;
