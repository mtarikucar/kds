export enum MarketingRole {
  SALES_MANAGER = 'SALES_MANAGER',
  SALES_REP = 'SALES_REP',
}

export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  NOT_REACHABLE = 'NOT_REACHABLE',
  MEETING_DONE = 'MEETING_DONE',
  DEMO_SCHEDULED = 'DEMO_SCHEDULED',
  OFFER_SENT = 'OFFER_SENT',
  WAITING = 'WAITING',
  WON = 'WON',
  LOST = 'LOST',
}

export enum BusinessType {
  CAFE = 'CAFE',
  RESTAURANT = 'RESTAURANT',
  BAR = 'BAR',
  PATISSERIE = 'PATISSERIE',
  FAST_FOOD = 'FAST_FOOD',
  OTHER = 'OTHER',
}

export enum LeadSource {
  INSTAGRAM = 'INSTAGRAM',
  REFERRAL = 'REFERRAL',
  FIELD_VISIT = 'FIELD_VISIT',
  ADS = 'ADS',
  WEBSITE = 'WEBSITE',
  PHONE = 'PHONE',
  OTHER = 'OTHER',
}

export enum ActivityType {
  CALL = 'CALL',
  VISIT = 'VISIT',
  NOTE = 'NOTE',
  EMAIL = 'EMAIL',
  WHATSAPP = 'WHATSAPP',
  STATUS_CHANGE = 'STATUS_CHANGE',
  DEMO = 'DEMO',
  MEETING = 'MEETING',
}

export enum TaskType {
  CALL = 'CALL',
  VISIT = 'VISIT',
  DEMO = 'DEMO',
  FOLLOW_UP = 'FOLLOW_UP',
  MEETING = 'MEETING',
  OTHER = 'OTHER',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum OfferStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export interface MarketingUserInfo {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

export interface Lead {
  id: string;
  businessName: string;
  contactPerson: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  city?: string;
  region?: string;
  businessType: string;
  tableCount?: number;
  branchCount?: number;
  currentSystem?: string;
  source: string;
  status: LeadStatus;
  lostReason?: string;
  notes?: string;
  nextFollowUp?: string;
  priority: string;
  assignedToId?: string;
  assignedTo?: MarketingUserInfo;
  convertedTenantId?: string;
  convertedAt?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { activities: number; offers: number; tasks: number };
}

export interface LeadActivity {
  id: string;
  type: string;
  title: string;
  description?: string;
  outcome?: string;
  duration?: number;
  leadId: string;
  createdById: string;
  createdBy: MarketingUserInfo;
  createdAt: string;
}

export interface MarketingTask {
  id: string;
  title: string;
  description?: string;
  type: string;
  status: string;
  priority: string;
  dueDate: string;
  completedAt?: string;
  leadId?: string;
  lead?: { id: string; businessName: string };
  assignedToId: string;
  assignedTo: MarketingUserInfo;
  createdAt: string;
}

export interface LeadOffer {
  id: string;
  planId?: string;
  customPrice?: number;
  discount?: number;
  trialDays?: number;
  notes?: string;
  status: string;
  validUntil?: string;
  sentAt?: string;
  respondedAt?: string;
  leadId: string;
  lead?: { id: string; businessName: string; contactPerson: string };
  createdById: string;
  createdBy: MarketingUserInfo;
  createdAt: string;
}

export interface Commission {
  id: string;
  amount: number;
  type: string;
  status: string;
  period: string;
  tenantId?: string;
  leadId?: string;
  notes?: string;
  marketingUserId: string;
  marketingUser: MarketingUserInfo;
  approvedAt?: string;
  paidAt?: string;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  [LeadStatus.NEW]: 'New',
  [LeadStatus.CONTACTED]: 'Contacted',
  [LeadStatus.NOT_REACHABLE]: 'Not Reachable',
  [LeadStatus.MEETING_DONE]: 'Meeting Done',
  [LeadStatus.DEMO_SCHEDULED]: 'Demo Scheduled',
  [LeadStatus.OFFER_SENT]: 'Offer Sent',
  [LeadStatus.WAITING]: 'Waiting',
  [LeadStatus.WON]: 'Won',
  [LeadStatus.LOST]: 'Lost',
};

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  [LeadStatus.NEW]: 'bg-blue-100 text-blue-800',
  [LeadStatus.CONTACTED]: 'bg-indigo-100 text-indigo-800',
  [LeadStatus.NOT_REACHABLE]: 'bg-orange-100 text-orange-800',
  [LeadStatus.MEETING_DONE]: 'bg-purple-100 text-purple-800',
  [LeadStatus.DEMO_SCHEDULED]: 'bg-cyan-100 text-cyan-800',
  [LeadStatus.OFFER_SENT]: 'bg-yellow-100 text-yellow-800',
  [LeadStatus.WAITING]: 'bg-gray-100 text-gray-800',
  [LeadStatus.WON]: 'bg-green-100 text-green-800',
  [LeadStatus.LOST]: 'bg-red-100 text-red-800',
};

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  [BusinessType.CAFE]: 'Cafe',
  [BusinessType.RESTAURANT]: 'Restaurant',
  [BusinessType.BAR]: 'Bar',
  [BusinessType.PATISSERIE]: 'Patisserie',
  [BusinessType.FAST_FOOD]: 'Fast Food',
  [BusinessType.OTHER]: 'Other',
};

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  [LeadSource.INSTAGRAM]: 'Instagram',
  [LeadSource.REFERRAL]: 'Referral',
  [LeadSource.FIELD_VISIT]: 'Field Visit',
  [LeadSource.ADS]: 'Ads',
  [LeadSource.WEBSITE]: 'Website',
  [LeadSource.PHONE]: 'Phone',
  [LeadSource.OTHER]: 'Other',
};
