export interface ContactFormData {
  name: string;
  email: string;
  phone?: string;
  message: string;
}

export interface ContactResponse {
  success: boolean;
  message: string;
}
