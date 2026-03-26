import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'staff';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  isApproved: boolean;
  createdAt: Timestamp;
}

export type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface OrderItem {
  name: string;
  unit: string;
  quantity: number;
  price: number;
  printingInfo: string;
}

export interface Order {
  id: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerTaxId: string;
  items: OrderItem[];
  subTotal: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  vatInvoiceCode: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ActivityLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  details: string;
  timestamp: Timestamp;
}

export type SupplierOrderStatus = 'pending' | 'received' | 'cancelled';
export type MaterialType = 'paper' | 'ink' | 'outsourcing' | 'other';

export interface SupplierOrder {
  id: string;
  supplierName: string;
  supplierPhone: string;
  supplierAddress: string;
  supplierTaxId: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  materialType: MaterialType;
  description: string;
  vatInvoiceCode: string;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  status: SupplierOrderStatus;
  paymentStatus: PaymentStatus;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PaperType {
  id: string;
  name: string;
  pricePerA4: number;
}

export interface PostProcessingType {
  id: string;
  name: string;
  pricePerM2?: number;
  pricePerUnit?: number;
  type: 'm2' | 'unit';
}

export interface PrintConfig {
  basePrice1Side: number;
  basePrice2Sides: number;
  tier1Threshold: number;
  tier1Discount: number;
  tier2Threshold: number;
  tier2Discount: number;
  tier3Threshold: number;
  tier3Discount: number;
}
