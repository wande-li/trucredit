// TypeScript type definitions — aggregated exports
export type * from "./credit";
export type * from "./collection";
export type * from "./invoice";

// Generic pagination
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Generic API response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
}

// Sort direction
export type SortDirection = "asc" | "desc";

export interface SortParams {
  field: string;
  direction: SortDirection;
}

// Filter params for list queries
export interface CustomerFilterParams extends PaginationParams {
  search?: string;
  status?: string;
  creditGrade?: string;
  riskLevel?: string;
  sort?: SortParams;
}

export interface InvoiceFilterParams extends PaginationParams {
  search?: string;
  status?: string;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: SortParams;
}
