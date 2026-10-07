export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  description: string;
  date: string;
  categoryId?: string;
  stageId?: string;
  clientId?: string;
  person?: string;
  notes?: string;
  attachmentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NamedOption {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  profession: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredAttachment {
  id: string;
  transactionId: string;
  fileName: string;
  fileType: string;
  blob: Blob;
  createdAt: number;
}

export interface Summary { income: number; expenses: number; balance: number }
