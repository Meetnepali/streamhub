export type PlanTier = 'FREE' | 'BRONZE' | 'SILVER' | 'GOLD';
export type Theme = 'LIGHT' | 'DARK';

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
  theme: Theme | null;
  themeManuallySet: boolean;
  city: string | null;
  state: string | null;
  country: string | null;
  plan: PlanTier;
  planExpiresAt: string | null;
  createdAt: string;
}
