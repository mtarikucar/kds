export interface MarketingJwtPayload {
  sub: string;
  email: string;
  role: string;
  type: 'marketing';
}

export interface MarketingUserPayload {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
}
