/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, onSnapshot, query, orderBy, doc, getDoc, setDoc, addDoc, Timestamp, serverTimestamp, where, limit, updateDoc, deleteDoc } from 'firebase/firestore';
import { 
  LayoutDashboard, 
  Printer, 
  FileText, 
  CreditCard, 
  History, 
  Users, 
  LogOut, 
  Plus, 
  Search, 
  Filter, 
  ChevronRight, 
  AlertCircle,
  TrendingUp,
  DollarSign,
  Clock,
  CheckCircle2,
  Menu,
  X,
  User as UserIcon,
  Receipt,
  Truck,
  Trash2,
  Calculator,
  Settings
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { format, subDays, startOfDay, endOfDay, isWithinInterval, parseISO } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { auth, db, loginWithGoogle, logout, handleFirestoreError, OperationType } from './firebase';
import ErrorBoundary from './components/ErrorBoundary';
import { UserRole, UserProfile, Order, ActivityLog, OrderStatus, PaymentStatus, OrderItem, SupplierOrder, SupplierOrderStatus, MaterialType, PaperType, PostProcessingType, PrintConfig } from './types';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
};

// --- Components ---

const SidebarItem = ({ to, icon: Icon, label, active, onClick }: { to?: string, icon: any, label: string, active?: boolean, onClick?: () => void }) => {
  const content = (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group cursor-pointer",
        active 
          ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" 
          : "text-slate-600 hover:bg-slate-100 hover:text-indigo-600"
      )}
      onClick={onClick}
    >
      <Icon className={cn("w-5 h-5", active ? "text-white" : "text-slate-400 group-hover:text-indigo-600")} />
      <span className="font-medium">{label}</span>
    </div>
  );

  if (to) {
    return <Link to={to}>{content}</Link>;
  }
  return content;
};

const StatCard = ({ title, value, icon: Icon, color, trend }: { title: string, value: string, icon: any, color: string, trend?: string }) => (
  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow duration-300">
    <div className="flex justify-between items-start mb-4">
      <div className={cn("p-3 rounded-xl", color)}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      {trend && (
        <span className={cn(
          "text-xs font-semibold px-2 py-1 rounded-full",
          trend.startsWith('+') ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
        )}>
          {trend}
        </span>
      )}
    </div>
    <h3 className="text-slate-500 text-sm font-medium mb-1">{title}</h3>
    <p className="text-2xl font-bold text-slate-900">{value}</p>
  </div>
);

// --- Pages ---

const Dashboard = ({ orders, supplierOrders, userRole, users = [] }: { orders: Order[], supplierOrders: SupplierOrder[], userRole?: string, users?: UserProfile[] }) => {
  const [dateRange, setDateRange] = useState({
    start: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });

  const stats = useMemo(() => {
    const start = startOfDay(parseISO(dateRange.start));
    const end = endOfDay(parseISO(dateRange.end));

    // Orders created in the period
    const periodOrders = orders.filter(o => {
      const date = o.createdAt.toDate();
      return isWithinInterval(date, { start, end });
    });

    // Supplier orders created in the period
    const periodSupplierOrders = supplierOrders.filter(o => {
      const date = o.createdAt.toDate();
      return isWithinInterval(date, { start, end });
    });

    // Revenue is based on paidAt date (fallback to createdAt for legacy data)
    const revenueOrders = orders.filter(o => {
      if (o.paymentStatus !== 'paid') return false;
      const date = (o.paidAt || o.createdAt).toDate();
      return isWithinInterval(date, { start, end });
    });
    const totalRevenue = revenueOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    // Expenses are based on paidAt date (fallback to createdAt for legacy data)
    const expenseOrders = supplierOrders.filter(o => {
      if (o.paymentStatus !== 'paid') return false;
      const date = (o.paidAt || o.createdAt).toDate();
      return isWithinInterval(date, { start, end });
    });
    const totalExpenses = expenseOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    // Other stats based on orders created in the period
    const totalPaid = periodOrders.reduce((sum, o) => sum + o.paidAmount, 0);
    const totalDebt = periodOrders.reduce((sum, o) => sum + o.debtAmount, 0);
    const totalExpensePaid = periodSupplierOrders.reduce((sum, o) => sum + o.paidAmount, 0);
    const totalExpenseDebt = periodSupplierOrders.reduce((sum, o) => sum + o.debtAmount, 0);

    // Pending and Quote orders based on createdAt
    const pendingOrders = periodOrders.filter(o => o.status === 'pending').length;
    const quoteOrders = periodOrders.filter(o => o.status === 'quote').length;

    // Chart data based on filtered range
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    
    // Limit chart to max 31 points for performance/readability
    const step = Math.max(1, Math.ceil(diffDays / 31));
    
    const chartData = [];
    for (let i = 0; i <= diffDays; i += step) {
      const date = subDays(end, diffDays - i);
      const dateStr = format(date, 'dd/MM');
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);
      
      const dayRevenue = orders.filter(o => {
        if (o.paymentStatus !== 'paid') return false;
        const date = (o.paidAt || o.createdAt).toDate();
        return isWithinInterval(date, { start: dayStart, end: dayEnd });
      }).reduce((sum, o) => sum + o.totalAmount, 0);

      const dayExpenses = supplierOrders.filter(o => {
        if (o.paymentStatus !== 'paid') return false;
        const date = (o.paidAt || o.createdAt).toDate();
        return isWithinInterval(date, { start: dayStart, end: dayEnd });
      }).reduce((sum, o) => sum + o.totalAmount, 0);

      const dayCount = orders.filter(o => {
        const orderDate = o.createdAt.toDate();
        return isWithinInterval(orderDate, { start: dayStart, end: dayEnd });
      }).length;

      chartData.push({
        name: dateStr,
        revenue: dayRevenue,
        expenses: dayExpenses,
        count: dayCount
      });
    }

    return { totalRevenue, totalPaid, totalDebt, totalExpenses, totalExpensePaid, totalExpenseDebt, pendingOrders, quoteOrders, chartData };
  }, [orders, supplierOrders, dateRange]);

  const getCreatorName = (uid: string) => {
    const creator = users.find(u => u.uid === uid);
    return creator ? (creator.displayName || creator.email) : 'Không rõ';
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Tổng quan</h1>
          <p className="text-slate-500">Chào mừng bạn trở lại hệ thống quản lý in ấn.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <input 
              type="date" 
              className="text-sm border-none bg-slate-50 rounded-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
            <span className="text-slate-400 text-xs">đến</span>
            <input 
              type="date" 
              className="text-sm border-none bg-slate-50 rounded-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
          </div>
          <div className="h-8 w-px bg-slate-100 hidden sm:block mx-2" />
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hôm nay</p>
            <p className="text-sm font-bold text-slate-700">{format(new Date(), 'dd/MM/yyyy')}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatCard title="Doanh thu" value={formatCurrency(stats.totalRevenue)} icon={DollarSign} color="bg-indigo-500" />
        <StatCard title="Chi phí" value={formatCurrency(stats.totalExpenses)} icon={Truck} color="bg-rose-500" />
        <StatCard title="Lợi nhuận" value={formatCurrency(stats.totalRevenue - stats.totalExpenses)} icon={TrendingUp} color="bg-emerald-500" />
        <StatCard title="Báo giá" value={stats.quoteOrders.toString()} icon={FileText} color="bg-slate-500" />
        <StatCard title="Chờ xử lý" value={stats.pendingOrders.toString()} icon={Clock} color="bg-amber-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900 mb-6">Biểu đồ thu chi</h2>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={stats.chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} tickFormatter={(v) => `${v/1000000}M`} />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(v: number, name: string) => [formatCurrency(v), name === 'revenue' ? 'Doanh thu' : 'Chi phí']}
                />
                <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} name="revenue" />
                <Bar dataKey="expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} name="expenses" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900 mb-6">Đơn hàng gần đây</h2>
          <div className="space-y-4">
            {orders.slice(0, 5).map(order => (
              <div key={order.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    order.status === 'completed' ? "bg-emerald-100 text-emerald-600" : "bg-indigo-100 text-indigo-600"
                  )}>
                    <Printer className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{order.customerName}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] text-indigo-600 font-mono font-bold">{order.orderCode || `AVP-OLD-${order.id.slice(-4).toUpperCase()}`}</p>
                      <p className="text-xs text-slate-500">{format(order.createdAt.toDate(), 'HH:mm dd/MM')}</p>
                      <span className="text-[10px] text-indigo-500 font-medium">• {getCreatorName(order.createdBy)}</span>
                    </div>
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-900">{formatCurrency(order.totalAmount)}</p>
              </div>
            ))}
          </div>
          <Link to="/orders" className="block text-center mt-6 text-sm font-medium text-indigo-600 hover:text-indigo-700">
            Xem tất cả đơn hàng
          </Link>
        </div>
      </div>
    </div>
  );
};

const PrintModal = ({ order, type, onClose }: { order: Order, type: 'quote' | 'delivery', onClose: () => void }) => {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 print:p-0 print:bg-white print:static print:block print-modal-container">
      <div className="bg-white w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl flex flex-col print:shadow-none print:max-h-none print:rounded-none print:overflow-visible print-modal-content">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center print:hidden print-modal-header">
          <h2 className="text-xl font-bold text-slate-900">
            {type === 'quote' ? 'Xem trước Báo giá' : 'Xem trước Phiếu giao hàng'}
          </h2>
          <div className="flex gap-3">
            <button 
              onClick={handlePrint}
              className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center gap-2"
            >
              <Printer className="w-5 h-5" /> In ngay
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-6 h-6 text-slate-400" />
            </button>
          </div>
        </div>
        
        <div className="p-12 print:p-0 print-modal-body">
          <div className="max-w-[1000px] mx-auto bg-white print:max-w-none print:w-full">
            <div className="flex justify-between items-start mb-10 border-b-2 border-orange-500 pb-8">
              <div className="flex items-center">
                <div className="flex-1">
                  <h2 className="text-xl font-black text-slate-900 uppercase leading-tight">Công ty TNHH TM-DV-SX An Việt Solution</h2>
                  <div className="text-sm text-slate-800 space-y-1 mt-1 font-medium">
                    <p>Xưởng in: 103A Quách Đình Bảo, P.Phú Thạnh, TP.HCM</p>
                    <p>Email: anviet.inan@gmail.com</p>
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-6">
                <h1 className="text-2xl font-black text-orange-500 uppercase mb-2 whitespace-nowrap">
                  {type === 'quote' ? 'BÁO GIÁ' : 'PHIẾU GIAO HÀNG'}
                </h1>
                <p className="text-slate-900 font-mono font-bold">{order.orderCode || `AVP-OLD-${order.id.slice(-4).toUpperCase()}`}</p>
                <p className="text-slate-700 text-sm mt-1 font-bold">Ngày: {format(new Date(), 'dd/MM/yyyy')}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-12 mb-10">
              <div>
                <h3 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-3">Khách hàng</h3>
                <p className="text-lg font-black text-slate-900">{order.customerName}</p>
                <p className="text-slate-900 font-bold">{order.customerPhone}</p>
                {order.customerAddress && <p className="text-slate-900 text-sm mt-1 font-bold">{order.customerAddress}</p>}
                {order.customerTaxId && <p className="text-slate-900 text-sm mt-1 font-bold">MST: {order.customerTaxId}</p>}
                {type === 'delivery' && order.vatInvoiceCode && <p className="text-slate-900 text-sm mt-1 font-bold">HĐ VAT: {order.vatInvoiceCode}</p>}
              </div>
              {/* Removed Order Info for Delivery as per request */}
            </div>

            <table className="w-full mb-10">
              <thead>
                <tr className="border-b-2 border-slate-900">
                  <th className="py-4 text-center text-sm font-black uppercase w-[5%]">STT</th>
                  <th className={cn("py-4 text-left text-sm font-black uppercase", type === 'delivery' ? "w-[35%]" : "w-[35%]")}>Hạng mục</th>
                  <th className={cn("py-4 text-center text-sm font-black uppercase", type === 'delivery' ? "w-[15%]" : "w-[10%]")}>ĐVT</th>
                  <th className={cn("py-4 text-center text-sm font-black uppercase", type === 'delivery' ? "w-[15%]" : "w-[10%]")}>SL</th>
                  {type === 'quote' ? (
                    <>
                      <th className="py-4 text-right text-sm font-black uppercase w-[20%]">Đơn giá</th>
                      <th className="py-4 text-right text-sm font-black uppercase w-[20%]">Thành tiền</th>
                    </>
                  ) : (
                    <th className="py-4 text-right text-sm font-black uppercase w-[30%]">Ghi chú</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.items.map((item, i) => (
                  <tr key={i}>
                    <td className="py-4 text-center text-slate-900 font-bold">{i + 1}</td>
                    <td className="py-4">
                      <p className="font-black text-slate-900">{item.name}</p>
                      {type === 'quote' && <p className="text-xs text-slate-700 mt-1 italic font-bold">{item.printingInfo}</p>}
                    </td>
                    <td className="py-4 text-center text-slate-900 font-bold">{item.unit || 'Cái'}</td>
                    <td className="py-4 text-center text-slate-900 font-bold">{item.quantity}</td>
                    {type === 'quote' ? (
                      <>
                        <td className="py-4 text-right text-slate-900 font-bold">{formatCurrency(item.price)}</td>
                        <td className="py-4 text-right font-black text-slate-900">{formatCurrency(item.quantity * item.price)}</td>
                      </>
                    ) : (
                      <td className="py-4 text-right text-slate-900 italic text-xs font-bold"></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {type === 'quote' && (
              <div className="flex justify-end items-end mb-12">
                <div className="w-64 space-y-3">
                  <div className="flex justify-between text-slate-900 font-bold">
                    <span>Tạm tính:</span>
                    <span>{formatCurrency(order.subTotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-900 font-bold">
                    <span>Thuế VAT ({order.vatRate}%):</span>
                    <span>{formatCurrency(order.vatAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-3 border-t-2 border-slate-900 text-xl font-black text-slate-900">
                    <span>TỔNG CỘNG:</span>
                    <span>{formatCurrency(order.totalAmount)}</span>
                  </div>
                </div>
              </div>
            )}

            {type === 'delivery' && (
              <div className="grid grid-cols-2 gap-12 pt-12 border-t border-slate-100">
                <div className="text-center">
                  <p className="font-bold text-slate-900 mb-20">Người nhận hàng</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-slate-900 mb-20">Người lập phiếu</p>
                </div>
              </div>
            )}
            
            <div className="mt-20 text-center text-[10px] text-slate-600 uppercase tracking-widest font-black">
              Cảm ơn quý khách đã tin tưởng sử dụng dịch vụ của chúng tôi!
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const OrderList = ({ orders, onEdit, onDelete, title = 'Quản lý đơn hàng', userRole, users = [], onPrint }: { orders: Order[], onEdit: (o: Order) => void, onDelete?: (id: string) => void, title?: string, userRole?: string, users?: UserProfile[], onPrint: (order: Order, type: 'quote' | 'delivery') => void }) => {
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | 'all'>('all');
  const [creatorFilter, setCreatorFilter] = useState<string | 'all'>('all');
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  });

  const getCreatorName = (uid: string) => {
    const creator = users.find(u => u.uid === uid);
    return creator ? (creator.displayName || creator.email) : 'Không rõ';
  };

  const filteredOrders = orders.filter(o => {
    const orderCode = o.orderCode || `AVP-OLD-${o.id.slice(-4).toUpperCase()}`;
    const matchesSearch = o.customerName.toLowerCase().includes(filter.toLowerCase()) || 
                         orderCode.toLowerCase().includes(filter.toLowerCase()) ||
                         o.vatInvoiceCode.toLowerCase().includes(filter.toLowerCase());
    const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
    const matchesPayment = paymentFilter === 'all' || o.paymentStatus === paymentFilter;
    const matchesCreator = creatorFilter === 'all' || o.createdBy === creatorFilter;
    
    let matchesDate = true;
    if (dateRange.start || dateRange.end) {
      const orderDate = o.createdAt.toDate();
      const start = dateRange.start ? startOfDay(parseISO(dateRange.start)) : null;
      const end = dateRange.end ? endOfDay(parseISO(dateRange.end)) : null;
      
      if (start && end) {
        matchesDate = isWithinInterval(orderDate, { start, end });
      } else if (start) {
        matchesDate = orderDate >= start;
      } else if (end) {
        matchesDate = orderDate <= end;
      }
    }

    return matchesSearch && matchesStatus && matchesPayment && matchesCreator && matchesDate;
  });

  const totalDebt = useMemo(() => {
    return filteredOrders.reduce((sum, order) => sum + (order.debtAmount || 0), 0);
  }, [filteredOrders]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {userRole !== 'production' && (
          <Link to="/orders/new" className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100">
            <Plus className="w-5 h-5" />
            Tạo đơn mới
          </Link>
        )}
      </div>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Tìm theo tên khách hàng hoặc mã VAT..." 
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 transition-all"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <select 
            className="px-4 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 transition-all text-slate-600"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="quote">Báo giá</option>
            <option value="pending">Chờ xử lý</option>
            <option value="processing">Đang in</option>
            <option value="completed">Hoàn thành</option>
            <option value="cancelled">Đã hủy</option>
          </select>
          <select 
            className="px-4 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 transition-all text-slate-600"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as any)}
          >
            <option value="all">Tất cả thanh toán</option>
            <option value="unpaid">Chưa trả</option>
            <option value="partial">Trả một phần</option>
            <option value="paid">Đã trả</option>
          </select>
          <select 
            className="px-4 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 transition-all text-slate-600"
            value={creatorFilter}
            onChange={(e) => setCreatorFilter(e.target.value)}
          >
            <option value="all">Tất cả người tạo</option>
            {users.map(u => (
              <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-50">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lọc theo ngày:</span>
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="date" 
              className="text-sm border-none bg-slate-50 rounded-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
            <span className="text-slate-400 text-xs">đến</span>
            <input 
              type="date" 
              className="text-sm border-none bg-slate-50 rounded-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
            {(dateRange.start || dateRange.end) && (
              <button 
                onClick={() => setDateRange({ start: '', end: '' })}
                className="text-xs text-rose-500 font-bold hover:underline ml-2"
              >
                Xóa lọc ngày
              </button>
            )}
          </div>
          {(title === 'Quản lý đơn hàng' || title === 'Quản lý công nợ') && (
            <div className="ml-auto flex items-center gap-2 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100">
              <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">Tổng công nợ chưa thu:</span>
              <span className="text-sm font-bold text-rose-600">{formatCurrency(totalDebt)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-100">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Khách hàng</th>
                {userRole !== 'production' && (
                  <>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Mã VAT</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng tiền</th>
                  </>
                )}
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Trạng thái</th>
                {userRole !== 'production' && (
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Thanh toán</th>
                )}
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Người tạo</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày tạo</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map(order => (
                <tr key={order.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4">
                    <p className="font-bold text-slate-900">{order.customerName}</p>
                    <p className="text-xs text-indigo-600 font-mono font-bold">{order.orderCode || `AVP-OLD-${order.id.slice(-4).toUpperCase()}`}</p>
                  </td>
                  {userRole !== 'production' && (
                    <>
                      <td className="px-6 py-4 text-sm text-slate-600 font-mono">{order.vatInvoiceCode || '-'}</td>
                      <td className="px-6 py-4 font-semibold text-slate-900">{formatCurrency(order.totalAmount)}</td>
                    </>
                  )}
                  <td className="px-6 py-4">
                    <span className={cn(
                      "text-xs font-bold px-2 py-1 rounded-full",
                      order.status === 'completed' ? "bg-emerald-50 text-emerald-600" :
                      order.status === 'processing' ? "bg-indigo-50 text-indigo-600" :
                      order.status === 'cancelled' ? "bg-rose-50 text-rose-600" : 
                      order.status === 'quote' ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-600"
                    )}>
                      {order.status === 'quote' ? 'Báo giá' :
                       order.status === 'pending' ? 'Chờ xử lý' : 
                       order.status === 'processing' ? 'Đang in' : 
                       order.status === 'completed' ? 'Hoàn thành' : 'Đã hủy'}
                    </span>
                  </td>
                  {userRole !== 'production' && (
                    <td className="px-6 py-4">
                      <span className={cn(
                        "text-xs font-bold px-2 py-1 rounded-full",
                        order.paymentStatus === 'paid' ? "bg-emerald-50 text-emerald-600" :
                        order.paymentStatus === 'partial' ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"
                      )}>
                        {order.paymentStatus === 'paid' ? 'Đã trả' : 
                         order.paymentStatus === 'partial' ? 'Trả một phần' : 'Chưa trả'}
                      </span>
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                        <UserIcon className="w-3 h-3 text-slate-400" />
                      </div>
                      <span className="text-xs text-slate-600 font-medium truncate max-w-[120px]" title={getCreatorName(order.createdBy)}>
                        {getCreatorName(order.createdBy)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{format(order.createdAt.toDate(), 'dd/MM/yyyy')}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {userRole !== 'production' && (
                        <>
                          <button 
                            onClick={() => onPrint(order, 'quote')}
                            title="In báo giá"
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          >
                            <Receipt className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => onPrint(order, 'delivery')}
                            title="Phiếu giao hàng"
                            className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                          >
                            <Truck className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button 
                        onClick={() => onEdit(order)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-sm transition-colors px-3 py-1 hover:bg-indigo-50 rounded-lg"
                      >
                        Chi tiết
                      </button>
                      {userRole === 'admin' && onDelete && (
                        <button 
                          onClick={() => {
                            if (window.confirm('Bạn có chắc chắn muốn xóa đơn hàng này?')) {
                              onDelete(order.id);
                            }
                          }}
                          title="Xóa đơn hàng"
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const OrderForm = ({ initialOrder, orders = [], onSave, onCancel, userRole, onPrint }: { initialOrder?: Order, orders?: Order[], onSave: (o: any) => void, onCancel: () => void, userRole?: string, onPrint: (order: Order, type: 'quote' | 'delivery') => void }) => {
  const isProduction = userRole === 'production';
  const isReadOnly = isProduction; // Production can only view details and update status

  const [formData, setFormData] = useState({
    customerName: initialOrder?.customerName || '',
    customerPhone: initialOrder?.customerPhone || '',
    customerAddress: initialOrder?.customerAddress || '',
    customerTaxId: initialOrder?.customerTaxId || '',
    vatInvoiceCode: initialOrder?.vatInvoiceCode || '',
    status: initialOrder?.status || 'quote',
    paymentStatus: initialOrder?.paymentStatus || 'unpaid',
    paidAmount: initialOrder?.paidAmount || 0,
    vatRate: initialOrder?.vatRate ?? 10,
    items: initialOrder?.items || [{ name: '', unit: 'Cái', quantity: 1, price: 0, printingInfo: '' }]
  });

  const subTotal = formData.items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
  const vatAmount = Math.round(subTotal * (formData.vatRate / 100));
  const totalAmount = subTotal + vatAmount;
  const debtAmount = totalAmount - formData.paidAmount;

  const customers = useMemo(() => {
    const map = new Map<string, { phone: string, address: string, taxId: string }>();
    orders.forEach(o => {
      if (o.customerName) {
        const key = o.customerName.trim().toLowerCase();
        if (!map.has(key)) {
          map.set(key, { 
            phone: o.customerPhone || '', 
            address: o.customerAddress || '', 
            taxId: o.customerTaxId || '' 
          });
        }
      }
    });
    return Array.from(map.entries()).map(([key, data]) => {
      const originalName = orders.find(o => o.customerName.trim().toLowerCase() === key)?.customerName || key;
      return { name: originalName, ...data };
    });
  }, [orders]);

  const handleAddItem = () => {
    setFormData({ ...formData, items: [...formData.items, { name: '', unit: 'Cái', quantity: 1, price: 0, printingInfo: '' }] });
  };

  const handleRemoveItem = (index: number) => {
    setFormData({ ...formData, items: formData.items.filter((_, i) => i !== index) });
  };

  const handleItemChange = (index: number, field: keyof OrderItem, value: any) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      subTotal,
      vatAmount,
      totalAmount,
      debtAmount,
      updatedAt: serverTimestamp()
    });
  };

  return (
    <div className="max-w-6xl mx-auto bg-white p-8 rounded-3xl shadow-xl border border-slate-100 animate-in zoom-in-95 duration-300">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-slate-900">{initialOrder ? 'Chi tiết đơn hàng' : 'Tạo đơn hàng mới'}</h1>
        <div className="flex items-center gap-2">
          {initialOrder && !isProduction && (
            <>
              <button 
                type="button"
                onClick={() => onPrint(initialOrder, 'quote')}
                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all flex items-center gap-2 px-3"
              >
                <Receipt className="w-5 h-5" />
                <span className="text-sm font-bold">Báo giá</span>
              </button>
              <button 
                type="button"
                onClick={() => onPrint(initialOrder, 'delivery')}
                className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all flex items-center gap-2 px-3"
              >
                <Truck className="w-5 h-5" />
                <span className="text-sm font-bold">Giao hàng</span>
              </button>
            </>
          )}
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Tên khách hàng *</label>
            <input 
              required
              type="text" 
              list="customer-suggestions"
              disabled={isProduction}
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
              value={formData.customerName}
              onChange={(e) => {
                const name = e.target.value;
                const found = customers.find(c => c.name === name);
                if (found) {
                  setFormData({ 
                    ...formData, 
                    customerName: name, 
                    customerPhone: found.phone || formData.customerPhone,
                    customerAddress: found.address || formData.customerAddress,
                    customerTaxId: found.taxId || formData.customerTaxId
                  });
                } else {
                  setFormData({ ...formData, customerName: name });
                }
              }}
            />
            <datalist id="customer-suggestions">
              {customers.map((c, i) => (
                <option key={i} value={c.name} />
              ))}
            </datalist>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Số điện thoại</label>
            <input 
              type="text" 
              disabled={isProduction}
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
              value={formData.customerPhone}
              onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-bold text-slate-700">Địa chỉ khách hàng</label>
            <input 
              type="text" 
              disabled={isProduction}
              placeholder="VD: 123 Đường ABC, Quận X, TP. HCM"
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
              value={formData.customerAddress}
              onChange={(e) => setFormData({ ...formData, customerAddress: e.target.value })}
            />
          </div>
          {!isProduction && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Mã số thuế khách hàng</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono disabled:opacity-60"
                  value={formData.customerTaxId}
                  onChange={(e) => setFormData({ ...formData, customerTaxId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Mã hóa đơn VAT</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono"
                  value={formData.vatInvoiceCode}
                  onChange={(e) => setFormData({ ...formData, vatInvoiceCode: e.target.value })}
                />
              </div>
            </>
          )}
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Trạng thái đơn hàng</label>
            <select 
              disabled={isProduction && initialOrder?.status === 'quote'}
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
            >
              {(!isProduction || initialOrder?.status === 'quote') && <option value="quote">Báo giá</option>}
              {(!isProduction || initialOrder?.status === 'pending') && <option value="pending">Chờ xử lý</option>}
              <option value="processing">Đang in</option>
              <option value="completed">Hoàn thành</option>
              {!isProduction && <option value="cancelled">Đã hủy</option>}
            </select>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-900">Danh mục in ấn</h3>
            {!isProduction && (
              <button 
                type="button" 
                onClick={handleAddItem}
                className="text-indigo-600 hover:text-indigo-700 text-sm font-bold flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Thêm hạng mục
              </button>
            )}
          </div>
          <div className="hidden md:grid grid-cols-[40px_1fr_80px_80px_120px_120px_40px] gap-3 px-4 mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">STT</span>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tên sản phẩm</span>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">ĐVT</span>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">SL</span>
            {!isProduction && (
              <>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Đơn giá</span>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Thành tiền</span>
              </>
            )}
            <span></span>
          </div>
          <div className="space-y-4">
            {formData.items.map((item, index) => (
              <div key={index} className="p-4 bg-slate-50 rounded-2xl space-y-3 animate-in slide-in-from-right-4 duration-200">
                <div className={cn(
                  "grid grid-cols-1 gap-3 items-start",
                  isProduction 
                    ? "md:grid-cols-[40px_1fr_80px_80px_40px]" 
                    : "md:grid-cols-[40px_1fr_80px_80px_120px_120px_40px]"
                )}>
                  <div className="hidden md:flex items-center justify-center h-10 font-bold text-slate-400 text-sm">
                    {index + 1}
                  </div>
                  <input 
                    required
                    disabled={isProduction}
                    placeholder="Tên sản phẩm"
                    className="w-full px-4 py-2 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                    value={item.name}
                    onChange={(e) => handleItemChange(index, 'name', e.target.value)}
                  />
                  <input 
                    required
                    disabled={isProduction}
                    placeholder="ĐVT"
                    className="w-full px-4 py-2 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 text-center"
                    value={item.unit}
                    onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                  />
                  <input 
                    required
                    disabled={isProduction}
                    type="number"
                    placeholder="SL"
                    className="w-full px-4 py-2 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 text-center"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                  />
                  {!isProduction && (
                    <>
                      <input 
                        required
                        type="number"
                        placeholder="Đơn giá"
                        className="w-full px-4 py-2 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 text-right"
                        value={item.price}
                        onChange={(e) => handleItemChange(index, 'price', Number(e.target.value))}
                      />
                      <div className="hidden md:flex items-center justify-end h-10 px-2 font-bold text-slate-900 text-sm">
                        {formatCurrency(item.quantity * item.price)}
                      </div>
                    </>
                  )}
                  {!isProduction && (
                    <button 
                      type="button" 
                      onClick={() => handleRemoveItem(index)}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors flex items-center justify-center"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
                <textarea 
                  disabled={isProduction}
                  placeholder="Thông tin in ấn (VD: Kích thước, chất liệu, gia công...)"
                  className="w-full px-4 py-2 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm disabled:opacity-60"
                  rows={2}
                  value={item.printingInfo}
                  onChange={(e) => handleItemChange(index, 'printingInfo', e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        {!isProduction && (
          <div className="bg-slate-50 p-6 rounded-2xl space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-slate-600 font-medium">Tạm tính:</span>
              <span className="text-lg font-semibold text-slate-900">{formatCurrency(subTotal)}</span>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-slate-600 font-medium">Thuế VAT (%):</span>
                <input 
                  type="number" 
                  className="w-20 px-2 py-1 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm font-bold disabled:opacity-60"
                  value={formData.vatRate}
                  onChange={(e) => setFormData({ ...formData, vatRate: Number(e.target.value) })}
                />
              </div>
              <span className="text-lg font-semibold text-slate-900">{formatCurrency(vatAmount)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-slate-200">
              <span className="text-slate-600 font-bold">Tổng cộng:</span>
              <span className="text-xl font-bold text-slate-900">{formatCurrency(totalAmount)}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Đã thanh toán</label>
                <input 
                  type="number" 
                  className="w-full px-4 py-3 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
                  value={formData.paidAmount}
                  onChange={(e) => setFormData({ ...formData, paidAmount: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Trạng thái thanh toán</label>
                <select 
                  className="w-full px-4 py-3 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
                  value={formData.paymentStatus}
                  onChange={(e) => setFormData({ ...formData, paymentStatus: e.target.value as any })}
                >
                  <option value="unpaid">Chưa trả</option>
                  <option value="partial">Trả một phần</option>
                  <option value="paid">Đã trả</option>
                </select>
              </div>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-slate-200">
              <span className="text-rose-600 font-bold">Còn nợ:</span>
              <span className="text-xl font-bold text-rose-600">{formatCurrency(debtAmount)}</span>
            </div>
          </div>
        )}

        <div className="flex gap-4 pt-4">
          <button 
            type="submit" 
            className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            {initialOrder ? 'Lưu thay đổi' : 'Tạo đơn hàng'}
          </button>
          <button 
            type="button" 
            onClick={onCancel}
            className="px-8 py-4 border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all"
          >
            Hủy
          </button>
        </div>
      </form>
    </div>
  );
};

const SupplierOrderList = ({ orders, onEdit, onDelete, userRole, users = [] }: { 
  orders: SupplierOrder[], 
  onEdit: (o: SupplierOrder) => void, 
  onDelete: (id: string) => void,
  userRole?: string,
  users?: UserProfile[] 
}) => {
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<SupplierOrderStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<MaterialType | 'all'>('all');
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const navigate = useNavigate();

  const getCreatorName = (uid: string) => {
    const creator = users.find(u => u.uid === uid);
    return creator ? (creator.displayName || creator.email) : 'Không rõ';
  };

  const filteredOrders = orders.filter(o => {
    const matchesSearch = o.supplierName.toLowerCase().includes(filter.toLowerCase()) || 
                         o.description.toLowerCase().includes(filter.toLowerCase()) ||
                         o.supplierTaxId?.toLowerCase().includes(filter.toLowerCase());
    const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
    const matchesType = typeFilter === 'all' || o.materialType === typeFilter;
    
    let matchesDate = true;
    if (dateRange.start || dateRange.end) {
      const orderDate = o.createdAt.toDate();
      const start = dateRange.start ? startOfDay(parseISO(dateRange.start)) : null;
      const end = dateRange.end ? endOfDay(parseISO(dateRange.end)) : null;
      
      if (start && end) {
        matchesDate = isWithinInterval(orderDate, { start, end });
      } else if (start) {
        matchesDate = orderDate >= start;
      } else if (end) {
        matchesDate = orderDate <= end;
      }
    }

    return matchesSearch && matchesStatus && matchesType && matchesDate;
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Quản lý nhà cung cấp</h1>
        <button 
          onClick={() => navigate('/suppliers/new')}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100"
        >
          <Plus className="w-5 h-5" />
          Tạo đơn mua mới
        </button>
      </div>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Tìm theo tên nhà cung cấp hoặc nội dung..." 
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 transition-all"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <select 
            className="px-4 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 transition-all text-slate-600"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="pending">Chờ nhận</option>
            <option value="received">Đã nhận</option>
            <option value="cancelled">Đã hủy</option>
          </select>
          <select 
            className="px-4 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 transition-all text-slate-600"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
          >
            <option value="all">Tất cả loại</option>
            <option value="paper">Giấy</option>
            <option value="ink">Mực</option>
            <option value="outsourcing">Gia công ngoài</option>
            <option value="other">Khác</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-50">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lọc theo ngày:</span>
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="date" 
              className="text-sm border-none bg-slate-50 rounded-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
            <span className="text-slate-400 text-xs">đến</span>
            <input 
              type="date" 
              className="text-sm border-none bg-slate-50 rounded-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
            {(dateRange.start || dateRange.end) && (
              <button 
                onClick={() => setDateRange({ start: '', end: '' })}
                className="text-xs text-rose-500 font-bold hover:underline ml-2"
              >
                Xóa lọc ngày
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-100">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Nhà cung cấp</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Loại vật tư</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tổng tiền</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Trạng thái</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Thanh toán</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ngày tạo</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map(order => (
                <tr key={order.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4">
                    <p className="font-bold text-slate-900">{order.supplierName}</p>
                    <p className="text-xs text-slate-500 truncate max-w-[200px]">{order.description}</p>
                    {order.vatInvoiceCode && <p className="text-[10px] font-mono text-indigo-600 font-bold mt-1">VAT: {order.vatInvoiceCode}</p>}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded-lg">
                      {order.materialType === 'paper' ? 'Giấy' : 
                       order.materialType === 'ink' ? 'Mực' : 
                       order.materialType === 'outsourcing' ? 'Gia công' : 'Khác'}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-semibold text-slate-900">{formatCurrency(order.totalAmount)}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "text-xs font-bold px-2 py-1 rounded-full",
                      order.status === 'received' ? "bg-emerald-50 text-emerald-600" :
                      order.status === 'cancelled' ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"
                    )}>
                      {order.status === 'pending' ? 'Chờ nhận' : 
                       order.status === 'received' ? 'Đã nhận' : 'Đã hủy'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "text-xs font-bold px-2 py-1 rounded-full",
                      order.paymentStatus === 'paid' ? "bg-emerald-50 text-emerald-600" :
                      order.paymentStatus === 'partial' ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"
                    )}>
                      {order.paymentStatus === 'paid' ? 'Đã trả' : 
                       order.paymentStatus === 'partial' ? 'Trả một phần' : 'Chưa trả'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{format(order.createdAt.toDate(), 'dd/MM/yyyy')}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => onEdit(order)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-sm transition-colors px-3 py-1 hover:bg-indigo-50 rounded-lg"
                      >
                        Chi tiết
                      </button>
                      {userRole === 'admin' && (
                        <button 
                          onClick={() => setConfirmDelete(order.id)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                          title="Xóa đơn mua"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mb-6 mx-auto">
              <Trash2 className="w-8 h-8 text-rose-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 text-center mb-2">Xác nhận xóa?</h3>
            <p className="text-slate-500 text-center mb-8">Hành động này không thể hoàn tác. Bạn có chắc chắn muốn xóa đơn mua này?</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all"
              >
                Hủy
              </button>
              <button 
                onClick={() => {
                  onDelete(confirmDelete);
                  setConfirmDelete(null);
                }}
                className="flex-1 px-4 py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-100"
              >
                Xóa ngay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SupplierOrderForm = ({ 
  initialOrder, 
  onSave, 
  onCancel, 
  userRole, 
  supplierOrders = [] 
}: { 
  initialOrder?: SupplierOrder, 
  onSave: (o: any) => void, 
  onCancel: () => void, 
  userRole?: string,
  supplierOrders?: SupplierOrder[]
}) => {
  const [formData, setFormData] = useState({
    supplierName: initialOrder?.supplierName || '',
    supplierPhone: initialOrder?.supplierPhone || '',
    supplierAddress: initialOrder?.supplierAddress || '',
    supplierTaxId: initialOrder?.supplierTaxId || '',
    bankName: initialOrder?.bankName || '',
    bankAccountName: initialOrder?.bankAccountName || '',
    bankAccountNumber: initialOrder?.bankAccountNumber || '',
    materialType: initialOrder?.materialType || 'paper',
    description: initialOrder?.description || '',
    vatInvoiceCode: initialOrder?.vatInvoiceCode || '',
    totalAmount: initialOrder?.totalAmount || 0,
    paidAmount: initialOrder?.paidAmount || 0,
    status: initialOrder?.status || 'pending',
    paymentStatus: initialOrder?.paymentStatus || 'unpaid'
  });

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<SupplierOrder[]>([]);

  const uniqueSuppliers = useMemo(() => {
    const seen = new Set();
    return supplierOrders.filter(order => {
      const duplicate = seen.has(order.supplierName.toLowerCase().trim());
      seen.add(order.supplierName.toLowerCase().trim());
      return !duplicate;
    });
  }, [supplierOrders]);

  const debtAmount = formData.totalAmount - formData.paidAmount;

  const handleNameChange = (name: string) => {
    setFormData({ ...formData, supplierName: name });
    if (name.trim()) {
      const filtered = uniqueSuppliers.filter(s => 
        s.supplierName.toLowerCase().includes(name.toLowerCase())
      );
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const selectSupplier = (supplier: SupplierOrder) => {
    setFormData({
      ...formData,
      supplierName: supplier.supplierName,
      supplierPhone: supplier.supplierPhone || '',
      supplierAddress: supplier.supplierAddress || '',
      supplierTaxId: supplier.supplierTaxId || '',
      bankName: supplier.bankName || '',
      bankAccountName: supplier.bankAccountName || '',
      bankAccountNumber: supplier.bankAccountNumber || '',
    });
    setShowSuggestions(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      debtAmount,
      updatedAt: serverTimestamp()
    });
  };

  return (
    <div className="max-w-4xl mx-auto bg-white p-8 rounded-3xl shadow-xl border border-slate-100 animate-in zoom-in-95 duration-300">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-slate-900">{initialOrder ? 'Cập nhật đơn mua' : 'Tạo đơn mua mới'}</h1>
        <button onClick={onCancel} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <X className="w-6 h-6 text-slate-400" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2 relative">
            <label className="text-sm font-bold text-slate-700">Tên nhà cung cấp *</label>
            <input 
              required
              type="text" 
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={formData.supplierName}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            />
            {showSuggestions && (
              <div className="absolute z-50 w-full mt-1 bg-white border border-slate-100 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors flex flex-col border-b border-slate-50 last:border-none"
                    onClick={() => selectSupplier(s)}
                  >
                    <span className="font-bold text-slate-900">{s.supplierName}</span>
                    <span className="text-[10px] text-slate-500 truncate">{s.supplierAddress}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Số điện thoại</label>
            <input 
              type="text" 
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={formData.supplierPhone}
              onChange={(e) => setFormData({ ...formData, supplierPhone: e.target.value })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-bold text-slate-700">Địa chỉ</label>
            <input 
              type="text" 
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={formData.supplierAddress}
              onChange={(e) => setFormData({ ...formData, supplierAddress: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Mã số thuế</label>
            <input 
              type="text" 
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono"
              value={formData.supplierTaxId}
              onChange={(e) => setFormData({ ...formData, supplierTaxId: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Mã hóa đơn VAT</label>
            <input 
              type="text" 
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono"
              value={formData.vatInvoiceCode}
              onChange={(e) => setFormData({ ...formData, vatInvoiceCode: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Loại vật tư *</label>
            <select 
              required
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={formData.materialType}
              onChange={(e) => setFormData({ ...formData, materialType: e.target.value as any })}
            >
              <option value="paper">Giấy</option>
              <option value="ink">Mực</option>
              <option value="outsourcing">Gia công ngoài</option>
              <option value="other">Khác</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Trạng thái *</label>
            <select 
              required
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
            >
              <option value="pending">Chờ nhận</option>
              <option value="received">Đã nhận</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </div>

          <div className="md:col-span-2 p-4 bg-slate-50 rounded-2xl space-y-4">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Thông tin thanh toán</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">Tên ngân hàng</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-2 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm"
                  value={formData.bankName}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">Số tài khoản</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-2 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
                  value={formData.bankAccountNumber}
                  onChange={(e) => setFormData({ ...formData, bankAccountNumber: e.target.value })}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-bold text-slate-700">Tên chủ tài khoản</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-2 bg-white border-none rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm"
                  value={formData.bankAccountName}
                  onChange={(e) => setFormData({ ...formData, bankAccountName: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-bold text-slate-700">Nội dung / Ghi chú</label>
            <textarea 
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Tổng tiền *</label>
            <input 
              required
              type="number" 
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={formData.totalAmount}
              onChange={(e) => setFormData({ ...formData, totalAmount: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Đã thanh toán</label>
            <input 
              type="number" 
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={formData.paidAmount}
              onChange={(e) => setFormData({ ...formData, paidAmount: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Trạng thái thanh toán</label>
            <select 
              className="w-full px-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-indigo-500"
              value={formData.paymentStatus}
              onChange={(e) => setFormData({ ...formData, paymentStatus: e.target.value as any })}
            >
              <option value="unpaid">Chưa trả</option>
              <option value="partial">Trả một phần</option>
              <option value="paid">Đã trả</option>
            </select>
          </div>
          <div className="flex items-end pb-3">
            <div className="w-full p-3 bg-rose-50 rounded-xl border border-rose-100">
              <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Còn nợ</p>
              <p className="text-lg font-bold text-rose-600">{formatCurrency(debtAmount)}</p>
            </div>
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          <button 
            type="submit" 
            className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            {initialOrder ? 'Lưu thay đổi' : 'Tạo đơn mua'}
          </button>
          <button 
            type="button" 
            onClick={onCancel}
            className="px-8 py-4 border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all"
          >
            Hủy
          </button>
        </div>
      </form>
    </div>
  );
};

const ActivityLogs = ({ logs }: { logs: ActivityLog[] }) => (
  <div className="space-y-6 animate-in fade-in duration-500">
    <h1 className="text-2xl font-bold text-slate-900">Lịch sử hoạt động</h1>
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="divide-y divide-slate-100">
        {logs.map(log => (
          <div key={log.id} className="p-4 flex gap-4 items-start hover:bg-slate-50 transition-colors">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <History className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm text-slate-900">
                <span className="font-bold">{log.userEmail}</span> {log.action}
              </p>
              <p className="text-xs text-slate-500 mt-1">{log.details}</p>
              <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-wider">
                {format(log.timestamp.toDate(), 'HH:mm:ss dd/MM/yyyy')}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// --- Price Calculator Component ---

const DEFAULT_PAPER_TYPES: PaperType[] = [
  { id: 'c150', name: 'Couche 150gsm', pricePerA4: 800 },
  { id: 'c300', name: 'Couche 300gsm', pricePerA4: 1500 },
  { id: 'f80', name: 'Ford 80gsm', pricePerA4: 500 },
  { id: 'f100', name: 'Ford 100gsm', pricePerA4: 650 },
  { id: 'br250', name: 'Bristol 250gsm', pricePerA4: 1200 },
  { id: 'decal_giay', name: 'Decal Giấy', pricePerA4: 1600 },
  { id: 'decal_nhua', name: 'Decal Nhựa', pricePerA4: 2200 },
];

const STANDARD_SIZES = [
  { id: 'a3', name: 'A3 (29.7 x 42 cm)', width: 29.7, height: 42 },
  { id: 'a4', name: 'A4 (21 x 29.7 cm)', width: 21, height: 29.7 },
  { id: 'a5', name: 'A5 (14.8 x 21 cm)', width: 14.8, height: 21 },
  { id: 'a6', name: 'A6 (10.5 x 14.8 cm)', width: 10.5, height: 14.8 },
  { id: 'namecard', name: 'Namecard (9 x 5.5 cm)', width: 9, height: 5.5 },
];

const DEFAULT_POST_PROCESSING: PostProcessingType[] = [
  { id: 'lam_bong', name: 'Cán bóng', pricePerM2: 5000, type: 'm2' },
  { id: 'lam_mo', name: 'Cán mờ', pricePerM2: 5000, type: 'm2' },
  { id: 'be_thanh_pham', name: 'Bế thành phẩm', pricePerUnit: 200, type: 'unit' },
  { id: 'can_gap', name: 'Cấn gấp', pricePerUnit: 100, type: 'unit' },
  { id: 'dong_cuon', name: 'Đóng cuốn', pricePerUnit: 2000, type: 'unit' },
];

const DEFAULT_PRINT_CONFIG: PrintConfig = {
  basePrice1Side: 1500,
  basePrice2Sides: 2500,
  tier1Threshold: 200,
  tier1Discount: 0.85,
  tier2Threshold: 500,
  tier2Discount: 0.7,
  tier3Threshold: 1000,
  tier3Discount: 0.6,
};

const PriceCalculator = ({ 
  isFloating, 
  onClose, 
  userRole,
  paperTypes,
  postProcessing,
  printConfig,
  onUpdatePaper,
  onUpdateProcessing,
  onUpdateConfig,
  isSidebarOpen = true
}: { 
  isFloating?: boolean, 
  onClose?: () => void,
  userRole?: 'admin' | 'staff' | 'production',
  paperTypes: PaperType[],
  postProcessing: PostProcessingType[],
  printConfig: PrintConfig,
  onUpdatePaper: (p: PaperType, action: 'add' | 'update' | 'delete') => void,
  onUpdateProcessing: (p: PostProcessingType, action: 'add' | 'update' | 'delete') => void,
  onUpdateConfig: (c: PrintConfig) => void,
  isSidebarOpen?: boolean
}) => {
  const [activeTab, setActiveTab] = useState<'calc' | 'settings'>('calc');
  const [paperId, setPaperId] = useState(paperTypes[0]?.id || '');
  const [sizeId, setSizeId] = useState(STANDARD_SIZES[1].id);
  const [isCustomSize, setIsCustomSize] = useState(false);
  const [customWidth, setCustomWidth] = useState(10);
  const [customHeight, setCustomHeight] = useState(10);
  const [quantity, setQuantity] = useState(100);
  const [selectedProcessing, setSelectedProcessing] = useState<string[]>([]);
  const [printSide, setPrintSide] = useState<'1' | '2'>('1');
  
  const [dimensions, setDimensions] = useState({ width: 1000, height: 800 });
  const [isResizing, setIsResizing] = useState(false);
  const dragControls = useDragControls();

  // Settings states
  const [editingConfig, setEditingConfig] = useState<PrintConfig>(printConfig);
  const [newPaper, setNewPaper] = useState({ name: '', pricePerA4: 0 });
  const [newProc, setNewProc] = useState({ name: '', pricePerM2: 0, pricePerUnit: 0, type: 'm2' as 'm2' | 'unit' });
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null);
  const [editingProcId, setEditingProcId] = useState<string | null>(null);

  useEffect(() => {
    if (paperTypes.length > 0 && !paperId) {
      setPaperId(paperTypes[0].id);
    }
  }, [paperTypes]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = dimensions.width;
    const startHeight = dimensions.height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(400, startWidth + (moveEvent.clientX - startX));
      const newHeight = Math.max(400, startHeight + (moveEvent.clientY - startY));
      setDimensions({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const calculation = useMemo(() => {
    const paper = paperTypes.find(p => p.id === paperId);
    if (!paper) return { paperCost: 0, printCost: 0, processingCost: 0, subtotal: 0, vat: 0, total: 0, unitPrice: 0 };

    const size = isCustomSize 
      ? { width: customWidth, height: customHeight }
      : STANDARD_SIZES.find(s => s.id === sizeId)!;

    const areaM2 = (size.width * size.height) / 10000;
    const a4AreaM2 = (21 * 29.7) / 10000;
    const paperCost = (areaM2 / a4AreaM2) * paper.pricePerA4 * quantity;
    
    const basePrintPrice = printSide === '1' ? printConfig.basePrice1Side : printConfig.basePrice2Sides;
    let printPricePerSheet = basePrintPrice;
    
    if (quantity >= printConfig.tier3Threshold) printPricePerSheet *= printConfig.tier3Discount;
    else if (quantity >= printConfig.tier2Threshold) printPricePerSheet *= printConfig.tier2Discount;
    else if (quantity >= printConfig.tier1Threshold) printPricePerSheet *= printConfig.tier1Discount;

    const printCost = printPricePerSheet * quantity;

    let processingCost = 0;
    selectedProcessing.forEach(id => {
      const proc = postProcessing.find(p => p.id === id);
      if (proc) {
        if (proc.pricePerM2) {
          processingCost += proc.pricePerM2 * areaM2 * quantity;
        } else if (proc.pricePerUnit) {
          processingCost += proc.pricePerUnit * quantity;
        }
      }
    });

    const subtotal = paperCost + printCost + processingCost;
    const vat = subtotal * 0.1;
    const total = subtotal + vat;

    return {
      paperCost,
      printCost,
      processingCost,
      subtotal,
      vat,
      total,
      unitPrice: total / quantity
    };
  }, [paperId, sizeId, isCustomSize, customWidth, customHeight, quantity, selectedProcessing, printSide, paperTypes, postProcessing, printConfig]);

  const handleAddPaper = () => {
    if (!newPaper.name) return;
    const id = newPaper.name.toLowerCase().replace(/\s+/g, '_');
    onUpdatePaper({ ...newPaper, id }, 'add');
    setNewPaper({ name: '', pricePerA4: 0 });
  };

  const handleDeletePaper = (id: string) => {
    onUpdatePaper({ id, name: '', pricePerA4: 0 }, 'delete');
  };

  const handleAddProc = () => {
    if (!newProc.name) return;
    const id = newProc.name.toLowerCase().replace(/\s+/g, '_');
    const newItem: PostProcessingType = { 
      id, 
      name: newProc.name, 
      type: newProc.type,
      pricePerM2: newProc.type === 'm2' ? (newProc.pricePerM2 || 0) : 0,
      pricePerUnit: newProc.type === 'unit' ? (newProc.pricePerUnit || 0) : 0
    };
    onUpdateProcessing(newItem, 'add');
    setNewProc({ name: '', pricePerM2: 0, pricePerUnit: 0, type: 'm2' });
  };

  const handleUpdateProcItem = (id: string, name: string, pricePerM2?: number, pricePerUnit?: number) => {
    const original = postProcessing.find(p => p.id === id);
    if (!original) return;
    const updated: PostProcessingType = { 
      ...original, 
      name, 
      pricePerM2: pricePerM2 || 0, 
      pricePerUnit: pricePerUnit || 0 
    };
    onUpdateProcessing(updated, 'update');
    setEditingProcId(null);
  };

  const handleDeleteProc = (id: string) => {
    onUpdateProcessing({ id, name: '', type: 'm2' }, 'delete');
  };

  const handleSaveConfig = () => {
    onUpdateConfig(editingConfig);
  };

  const handleUpdatePaperItem = (id: string, name: string, pricePerA4: number) => {
    onUpdatePaper({ id, name, pricePerA4 }, 'update');
    setEditingPaperId(null);
  };

  const calcContent = (
    <div className={cn(
      "grid gap-6",
      isFloating ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 lg:grid-cols-3 gap-8"
    )}>
      <div className={cn(
        "space-y-4",
        isFloating ? "md:col-span-1 lg:col-span-2" : "lg:col-span-2"
      )}>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            Thông số sản phẩm
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase">Loại giấy</label>
                <select 
                  value={paperId}
                  onChange={(e) => setPaperId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-base font-medium"
                >
                  {paperTypes.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase">Số lượng</label>
                <input 
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-base"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase">Mặt in</label>
                <div className="flex gap-2 p-1.5 bg-slate-100 rounded-xl">
                  <button 
                    onClick={() => setPrintSide('1')}
                    className={cn(
                      "flex-1 py-2.5 rounded-lg text-sm font-bold transition-all",
                      printSide === '1' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                    )}
                  >
                    1 mặt
                  </button>
                  <button 
                    onClick={() => setPrintSide('2')}
                    className={cn(
                      "flex-1 py-2.5 rounded-lg text-sm font-bold transition-all",
                      printSide === '2' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                    )}
                  >
                    2 mặt
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-500 uppercase">Kích thước</label>
                <div className="flex gap-2 p-1.5 bg-slate-100 rounded-xl">
                  <button 
                    onClick={() => setIsCustomSize(false)}
                    className={cn(
                      "flex-1 py-2.5 rounded-lg text-sm font-bold transition-all",
                      !isCustomSize ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                    )}
                  >
                    Chuẩn
                  </button>
                  <button 
                    onClick={() => setIsCustomSize(true)}
                    className={cn(
                      "flex-1 py-2.5 rounded-lg text-sm font-bold transition-all",
                      isCustomSize ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                    )}
                  >
                    Tùy chỉnh
                  </button>
                </div>
              </div>
            </div>

            {!isCustomSize ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                  {STANDARD_SIZES.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSizeId(s.id)}
                      className={cn(
                        "px-4 py-3 rounded-xl border text-sm font-bold transition-all",
                        sizeId === s.id 
                          ? "border-indigo-600 bg-indigo-50 text-indigo-600" 
                          : "border-slate-200 text-slate-600 hover:border-indigo-200"
                      )}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6 p-5 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Rộng (cm)</label>
                  <input 
                    type="number"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Cao (cm)</label>
                  <input 
                    type="number"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-base"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Plus className="w-5 h-5 text-indigo-600" />
            Gia công sau in
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {postProcessing.map(proc => (
              <label 
                key={proc.id}
                className={cn(
                  "flex items-center gap-4 p-4 rounded-2xl border cursor-pointer transition-all",
                  selectedProcessing.includes(proc.id)
                    ? "border-indigo-600 bg-indigo-50"
                    : "border-slate-100 hover:border-indigo-200"
                )}
              >
                <input 
                  type="checkbox"
                  checked={selectedProcessing.includes(proc.id)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedProcessing([...selectedProcessing, proc.id]);
                    else setSelectedProcessing(selectedProcessing.filter(id => id !== proc.id));
                  }}
                  className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className={cn(
                  "text-sm font-bold",
                  selectedProcessing.includes(proc.id) ? "text-indigo-900" : "text-slate-600"
                )}>
                  {proc.name}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className={cn(
          "bg-indigo-600 p-8 rounded-3xl shadow-2xl shadow-indigo-200 text-white",
          !isFloating && "sticky top-8"
        )}>
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <DollarSign className="w-6 h-6" />
            Kết quả tính toán
          </h2>

          <div className="grid grid-cols-1 gap-y-3 mb-6 text-sm">
            <div className="flex justify-between text-indigo-100 pb-2 border-b border-white/10">
              <span>Tiền giấy</span>
              <span className="font-bold text-white text-base">{formatCurrency(calculation.paperCost)}</span>
            </div>
            <div className="flex justify-between text-indigo-100 pb-2 border-b border-white/10">
              <span>Tiền in</span>
              <span className="font-bold text-white text-base">{formatCurrency(calculation.printCost)}</span>
            </div>
            <div className="flex justify-between text-indigo-100 pb-2 border-b border-white/10">
              <span>Gia công</span>
              <span className="font-bold text-white text-base">{formatCurrency(calculation.processingCost)}</span>
            </div>
            <div className="flex justify-between text-indigo-100 pb-2 border-b border-white/10">
              <span>VAT (10%)</span>
              <span className="font-bold text-white text-base">{formatCurrency(calculation.vat)}</span>
            </div>
          </div>

          <div className="pt-4 border-t border-indigo-400/50 flex justify-between text-indigo-100 mb-6 text-base">
            <span>Tạm tính</span>
            <span className="font-bold text-white text-lg">{formatCurrency(calculation.subtotal)}</span>
          </div>

          <div className="bg-white/10 p-6 rounded-2xl mb-8">
            <p className="text-indigo-100 text-xs mb-2 uppercase tracking-widest font-black">Tổng cộng thanh toán</p>
            <p className="text-4xl font-black">{formatCurrency(calculation.total)}</p>
            <p className="text-indigo-200 text-xs mt-2 italic font-medium">* Đơn giá: {formatCurrency(calculation.unitPrice)} / sản phẩm</p>
          </div>

          <button 
            onClick={() => window.print()}
            className="w-full bg-white text-indigo-600 py-4 rounded-2xl font-black hover:bg-indigo-50 transition-all flex items-center justify-center gap-3 text-base shadow-lg"
          >
            <Printer className="w-5 h-5" />
            In báo giá chi tiết
          </button>
        </div>
      </div>
    </div>
  );

  const settingsContent = (
    <div className={cn(
      "grid gap-6 pb-10",
      isFloating ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
    )}>
      <div className="space-y-6">
        {/* Print Config */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Settings className="w-4 h-4 text-indigo-600" />
          Cấu hình giá in chung
        </h3>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Giá in 1 mặt</label>
            <input 
              type="number"
              value={editingConfig.basePrice1Side}
              onChange={(e) => setEditingConfig({ ...editingConfig, basePrice1Side: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base font-medium"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Giá in 2 mặt</label>
            <input 
              type="number"
              value={editingConfig.basePrice2Sides}
              onChange={(e) => setEditingConfig({ ...editingConfig, basePrice2Sides: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base font-medium"
            />
          </div>
        </div>
        <div className="space-y-4">
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Giảm giá theo số lượng</p>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Mốc 1 (Số lượng)</label>
              <input type="number" value={editingConfig.tier1Threshold} onChange={(e) => setEditingConfig({ ...editingConfig, tier1Threshold: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Hệ số nhân (VD: 0.85)</label>
              <input type="number" step="0.01" value={editingConfig.tier1Discount} onChange={(e) => setEditingConfig({ ...editingConfig, tier1Discount: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Mốc 2 (Số lượng)</label>
              <input type="number" value={editingConfig.tier2Threshold} onChange={(e) => setEditingConfig({ ...editingConfig, tier2Threshold: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Hệ số nhân (VD: 0.7)</label>
              <input type="number" step="0.01" value={editingConfig.tier2Discount} onChange={(e) => setEditingConfig({ ...editingConfig, tier2Discount: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Mốc 3 (Số lượng)</label>
              <input type="number" value={editingConfig.tier3Threshold} onChange={(e) => setEditingConfig({ ...editingConfig, tier3Threshold: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Hệ số nhân (VD: 0.6)</label>
              <input type="number" step="0.01" value={editingConfig.tier3Discount} onChange={(e) => setEditingConfig({ ...editingConfig, tier3Discount: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base" />
            </div>
          </div>
        </div>
        <button onClick={handleSaveConfig} className="w-full bg-indigo-600 text-white py-3 rounded-2xl font-black hover:bg-indigo-700 transition-all text-base shadow-lg">
          Lưu cấu hình chung
        </button>
      </div>

      {/* Paper Types */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-600" />
          Quản lý loại giấy
        </h3>
        <div className="space-y-3">
          {paperTypes.map(p => (
            <div key={p.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              {editingPaperId === p.id ? (
                <div className="space-y-3">
                  <input 
                    className="w-full px-3 py-2 text-base border rounded-xl"
                    defaultValue={p.name}
                    id={`edit-paper-name-${p.id}`}
                  />
                  <div className="flex gap-3">
                    <input 
                      type="number"
                      className="flex-1 px-3 py-2 text-base border rounded-xl"
                      defaultValue={p.pricePerA4}
                      id={`edit-paper-price-${p.id}`}
                    />
                    <button 
                      onClick={() => {
                        const name = (document.getElementById(`edit-paper-name-${p.id}`) as HTMLInputElement).value;
                        const price = parseInt((document.getElementById(`edit-paper-price-${p.id}`) as HTMLInputElement).value) || 0;
                        handleUpdatePaperItem(p.id, name, price);
                      }}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-black rounded-xl"
                    >
                      Lưu
                    </button>
                    <button 
                      onClick={() => setEditingPaperId(null)}
                      className="px-4 py-2 bg-slate-200 text-slate-600 text-sm font-black rounded-xl"
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-bold text-slate-900">{p.name}</p>
                    <p className="text-sm text-slate-500 font-medium">{formatCurrency(p.pricePerA4)} / tờ A4</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingPaperId(p.id)} className="p-2.5 text-slate-400 hover:text-indigo-600 transition-colors bg-white rounded-xl shadow-sm">
                      <Plus className="w-5 h-5 rotate-45" />
                    </button>
                    <button onClick={() => handleDeletePaper(p.id)} className="p-2.5 text-slate-400 hover:text-rose-600 transition-colors bg-white rounded-xl shadow-sm">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="pt-5 border-t border-slate-100 space-y-4">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Thêm loại giấy mới</p>
          <div className="grid grid-cols-2 gap-3">
            <input 
              placeholder="Tên giấy" 
              value={newPaper.name} 
              onChange={(e) => setNewPaper({ ...newPaper, name: e.target.value })}
              className="px-4 py-3 rounded-xl border border-slate-200 text-base"
            />
            <input 
              type="number" 
              placeholder="Giá / tờ A4" 
              value={newPaper.pricePerA4 || ''} 
              onChange={(e) => setNewPaper({ ...newPaper, pricePerA4: parseInt(e.target.value) || 0 })}
              className="px-4 py-3 rounded-xl border border-slate-200 text-base"
            />
          </div>
          <button onClick={handleAddPaper} className="w-full bg-slate-900 text-white py-3 rounded-2xl font-black hover:bg-slate-800 transition-all text-base flex items-center justify-center gap-3">
            <Plus className="w-5 h-5" /> Thêm giấy mới
          </button>
        </div>
      </div>
    </div>

    <div className="space-y-6">
      {/* Post Processing */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Plus className="w-5 h-5 text-indigo-600" />
          Quản lý gia công
        </h3>
        <div className="space-y-3">
          {postProcessing.map(p => (
            <div key={p.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              {editingProcId === p.id ? (
                <div className="space-y-3">
                  <input 
                    className="w-full px-3 py-2 text-base border rounded-xl"
                    defaultValue={p.name}
                    id={`edit-proc-name-${p.id}`}
                  />
                  <div className="flex gap-3">
                    <input 
                      type="number"
                      className="flex-1 px-3 py-2 text-base border rounded-xl"
                      defaultValue={p.type === 'm2' ? p.pricePerM2 : p.pricePerUnit}
                      id={`edit-proc-price-${p.id}`}
                    />
                    <button 
                      onClick={() => {
                        const name = (document.getElementById(`edit-proc-name-${p.id}`) as HTMLInputElement).value;
                        const price = parseInt((document.getElementById(`edit-proc-price-${p.id}`) as HTMLInputElement).value) || 0;
                        handleUpdateProcItem(p.id, name, p.type === 'm2' ? price : undefined, p.type === 'unit' ? price : undefined);
                      }}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-black rounded-xl"
                    >
                      Lưu
                    </button>
                    <button 
                      onClick={() => setEditingProcId(null)}
                      className="px-4 py-2 bg-slate-200 text-slate-600 text-sm font-black rounded-xl"
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-bold text-slate-900">{p.name}</p>
                    <p className="text-sm text-slate-500 font-medium">
                      {p.pricePerM2 ? `${formatCurrency(p.pricePerM2)} / m²` : `${formatCurrency(p.pricePerUnit || 0)} / sp`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingProcId(p.id)} className="p-2.5 text-slate-400 hover:text-indigo-600 transition-colors bg-white rounded-xl shadow-sm">
                      <Plus className="w-5 h-5 rotate-45" />
                    </button>
                    <button onClick={() => handleDeleteProc(p.id)} className="p-2.5 text-slate-400 hover:text-rose-600 transition-colors bg-white rounded-xl shadow-sm">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="pt-5 border-t border-slate-100 space-y-4">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Thêm gia công mới</p>
          <input 
            placeholder="Tên gia công" 
            value={newProc.name} 
            onChange={(e) => setNewProc({ ...newProc, name: e.target.value })}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base"
          />
          <div className="grid grid-cols-2 gap-3">
            <select 
              value={newProc.type} 
              onChange={(e) => setNewProc({ ...newProc, type: e.target.value as 'm2' | 'unit' })}
              className="px-4 py-3 rounded-xl border border-slate-200 text-base"
            >
              <option value="m2">Tính theo m²</option>
              <option value="unit">Tính theo sản phẩm</option>
            </select>
            <input 
              type="number" 
              placeholder="Đơn giá" 
              value={newProc.type === 'm2' ? (newProc.pricePerM2 || '') : (newProc.pricePerUnit || '')} 
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                if (newProc.type === 'm2') setNewProc({ ...newProc, pricePerM2: val });
                else setNewProc({ ...newProc, pricePerUnit: val });
              }}
              className="px-4 py-3 rounded-xl border border-slate-200 text-base"
            />
          </div>
          <button onClick={handleAddProc} className="w-full bg-slate-900 text-white py-3 rounded-2xl font-black hover:bg-slate-800 transition-all text-base flex items-center justify-center gap-3">
            <Plus className="w-5 h-5" /> Thêm gia công mới
          </button>
        </div>
      </div>
    </div>
  </div>
);

  const finalContent = (
    <div className={cn(
      "space-y-6",
      isFloating ? "p-6" : "max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500"
    )}>
      {!isFloating && (
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black text-slate-900">Tính giá in tự động</h1>
            <p className="text-slate-500 mt-1">Ước tính chi phí sản xuất nhanh chóng</p>
          </div>
          <div className="flex items-center gap-4">
            {userRole === 'admin' && (
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button 
                  onClick={() => setActiveTab('calc')}
                  className={cn("px-4 py-2 rounded-lg text-sm font-bold transition-all", activeTab === 'calc' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500")}
                >
                  Tính giá
                </button>
                <button 
                  onClick={() => setActiveTab('settings')}
                  className={cn("px-4 py-2 rounded-lg text-sm font-bold transition-all", activeTab === 'settings' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500")}
                >
                  Cài đặt giá
                </button>
              </div>
            )}
            <div className="bg-indigo-50 p-3 rounded-2xl">
              <Calculator className="w-8 h-8 text-indigo-600" />
            </div>
          </div>
        </div>
      )}

      {isFloating && userRole === 'admin' && (
        <div className="flex bg-slate-100 p-1.5 rounded-xl mb-6">
          <button 
            onClick={() => setActiveTab('calc')}
            className={cn("flex-1 py-2 rounded-lg text-sm font-bold transition-all", activeTab === 'calc' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500")}
          >
            Tính giá
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={cn("flex-1 py-2 rounded-lg text-sm font-bold transition-all", activeTab === 'settings' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500")}
          >
            Cài đặt
          </button>
        </div>
      )}

      {activeTab === 'calc' ? calcContent : settingsContent}
    </div>
  );

  if (isFloating) {
    const sidebarWidth = isSidebarOpen ? 288 : 0;
    return (
      <motion.div
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        initial={{ opacity: 0, scale: 0.9, x: sidebarWidth + 20, y: 50 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="fixed z-[200] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        style={{ 
          top: '50px', 
          left: `${sidebarWidth + 20}px`,
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          maxHeight: '90vh',
          maxWidth: `calc(100vw - ${sidebarWidth + 40}px)`
        }}
      >
        <div 
          onPointerDown={(e) => dragControls.start(e)}
          className="bg-slate-900 p-4 flex justify-between items-center cursor-move"
        >
          <div className="flex items-center gap-2 text-white">
            <Calculator className="w-6 h-6 text-indigo-400" />
            <span className="font-black text-base tracking-tight">Tính giá in nhanh</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {finalContent}
        </div>
        
        {/* Resize Handle */}
        <div 
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize flex items-center justify-center group"
        >
          <div className="w-1.5 h-1.5 bg-slate-300 rounded-full group-hover:bg-indigo-500 transition-colors" />
          <div className="absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 border-slate-200 rounded-br-sm group-hover:border-indigo-400 transition-colors" />
        </div>
      </motion.div>
    );
  }

  return finalContent;
};

const UserManagement = ({ users, onUpdateRole, onApprove, onDelete }: { 
  users: UserProfile[], 
  onUpdateRole: (uid: string, role: UserRole) => void, 
  onApprove: (uid: string) => void,
  onDelete: (uid: string) => void
}) => {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const pendingUsers = users.filter(u => !u.isApproved);
  const approvedUsers = users.filter(u => u.isApproved);

  const handleDelete = (uid: string) => {
    onDelete(uid);
    setConfirmDelete(null);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-slate-100 text-center space-y-6">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-600 mx-auto">
              <Trash2 className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900">Xác nhận xóa?</h3>
              <p className="text-slate-500">
                Bạn có chắc chắn muốn xóa tài khoản này? Hành động này không thể hoàn tác.
              </p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all"
              >
                Hủy
              </button>
              <button 
                onClick={() => handleDelete(confirmDelete)}
                className="flex-1 px-4 py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-100"
              >
                Xóa ngay
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Quản lý nhân sự</h1>
        <div className="bg-amber-50 text-amber-700 px-4 py-2 rounded-xl text-sm font-medium border border-amber-100">
          Nhân viên mới cần được Quản trị viên phê duyệt trước khi truy cập hệ thống.
        </div>
      </div>

      {pendingUsers.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-rose-600 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Yêu cầu phê duyệt ({pendingUsers.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pendingUsers.map(user => (
              <div key={user.uid} className="bg-white p-6 rounded-2xl shadow-sm border-2 border-rose-100 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center text-rose-600">
                    <UserIcon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 truncate">{user.displayName || user.email}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                </div>
                <button 
                  onClick={() => onApprove(user.uid)}
                  className="w-full bg-rose-600 text-white py-2 rounded-xl font-bold hover:bg-rose-700 transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Phê duyệt ngay
                </button>
                <button 
                  onClick={() => setConfirmDelete(user.uid)}
                  className="w-full bg-slate-100 text-slate-600 py-2 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Từ chối / Xóa
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">Nhân viên đã phê duyệt</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {approvedUsers.map(user => (
            <div key={user.uid} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                  <UserIcon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 truncate">{user.displayName || user.email}</p>
                  <p className="text-xs text-slate-500 truncate">{user.email}</p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                  user.role === 'admin' ? "bg-indigo-100 text-indigo-600" : 
                  user.role === 'production' ? "bg-amber-100 text-amber-600" :
                  "bg-slate-100 text-slate-600"
                )}>
                  {user.role === 'admin' ? 'Quản trị' : user.role === 'production' ? 'Sản xuất' : 'Bán hàng'}
                </span>
                <select 
                  className="text-xs border-none bg-slate-50 rounded-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500"
                  value={user.role}
                  onChange={(e) => onUpdateRole(user.uid, e.target.value as any)}
                >
                  <option value="staff">NV Bán hàng</option>
                  <option value="production">NV Sản xuất</option>
                  <option value="admin">Quản trị viên</option>
                </select>
                <button 
                  onClick={() => setConfirmDelete(user.uid)}
                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                  title="Xóa tài khoản"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isFirebaseBlocked, setIsFirebaseBlocked] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [printOrder, setPrintOrder] = useState<{ order: Order, type: 'quote' | 'delivery' } | null>(null);
  const [supplierOrders, setSupplierOrders] = useState<SupplierOrder[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editingSupplierOrder, setEditingSupplierOrder] = useState<SupplierOrder | null>(null);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isCalculatorOpen, setCalculatorOpen] = useState(false);
  
  // Pricing settings
  const [paperTypes, setPaperTypes] = useState<PaperType[]>([]);
  const [postProcessing, setPostProcessing] = useState<PostProcessingType[]>([]);
  const [printConfig, setPrintConfig] = useState<PrintConfig>(DEFAULT_PRINT_CONFIG);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        // Fetch or create profile
        const fetchProfile = async () => {
          try {
            const profileDoc = await getDoc(doc(db, 'users', u.uid));
            const isAdmin = u.email === 'voanhduy1993@gmail.com';
            
            if (profileDoc.exists()) {
              const data = profileDoc.data() as UserProfile;
              // Ensure admin email always has admin role and is approved
              if (isAdmin && (!data.isApproved || data.role !== 'admin')) {
                const updatedProfile = { ...data, isApproved: true, role: 'admin' as const };
                await updateDoc(doc(db, 'users', u.uid), { isApproved: true, role: 'admin' });
                setProfile(updatedProfile);
              } else {
                setProfile(data);
              }
            } else {
              const newProfile: UserProfile = {
                uid: u.uid,
                email: u.email!,
                displayName: u.displayName || '',
                role: isAdmin ? 'admin' : 'staff',
                isApproved: isAdmin,
                createdAt: Timestamp.now()
              };
              await setDoc(doc(db, 'users', u.uid), newProfile);
              setProfile(newProfile);
            }
          } catch (error: any) {
            console.error('Profile fetch error:', error);
            if (error.message.includes('blocked') || error.message.includes('failed to fetch')) {
              setIsFirebaseBlocked(true);
            }
          }
        };
        fetchProfile();
      } else {
        setProfile(null);
      }
      setLoading(false);
    }, (error: any) => {
      console.error('Auth state change error:', error);
      if (error.message.includes('blocked')) setIsFirebaseBlocked(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

    // Fetch Paper Types
    const unsubPaper = onSnapshot(collection(db, 'settings_paper'), (snapshot) => {
      if (snapshot.empty) {
        // Seed initial data
        DEFAULT_PAPER_TYPES.forEach(p => setDoc(doc(db, 'settings_paper', p.id), p));
      } else {
        setPaperTypes(snapshot.docs.map(d => d.data() as PaperType));
      }
    });

    // Fetch Post Processing
    const unsubProc = onSnapshot(collection(db, 'settings_processing'), (snapshot) => {
      if (snapshot.empty) {
        // Seed initial data
        DEFAULT_POST_PROCESSING.forEach(p => setDoc(doc(db, 'settings_processing', p.id), p));
      } else {
        setPostProcessing(snapshot.docs.map(d => d.data() as PostProcessingType));
      }
    });

    // Fetch Print Config
    const unsubConfig = onSnapshot(doc(db, 'settings_print_config', 'main'), (docSnap) => {
      if (!docSnap.exists()) {
        // Seed initial data
        setDoc(doc(db, 'settings_print_config', 'main'), DEFAULT_PRINT_CONFIG);
      } else {
        setPrintConfig(docSnap.data() as PrintConfig);
      }
    });

    return () => {
      unsubPaper();
      unsubProc();
      unsubConfig();
    };
  }, [user]);

  const handleUpdatePaper = async (paper: PaperType, action: 'add' | 'update' | 'delete') => {
    if (profile?.role !== 'admin') return;
    if (action === 'delete') {
      await deleteDoc(doc(db, 'settings_paper', paper.id));
    } else {
      await setDoc(doc(db, 'settings_paper', paper.id), paper);
    }
  };

  const handleUpdateProcessing = async (proc: PostProcessingType, action: 'add' | 'update' | 'delete') => {
    if (profile?.role !== 'admin') return;
    if (action === 'delete') {
      await deleteDoc(doc(db, 'settings_processing', proc.id));
    } else {
      await setDoc(doc(db, 'settings_processing', proc.id), proc);
    }
  };

  const handleUpdatePrintConfig = async (updated: PrintConfig) => {
    if (profile?.role !== 'admin') return;
    await setDoc(doc(db, 'settings_print_config', 'main'), updated);
  };

  useEffect(() => {
    if (!user) return;
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        setProfile(doc.data() as UserProfile);
      }
    });
    return unsubProfile;
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const qOrders = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubOrders = onSnapshot(qOrders, (snapshot) => {
      setOrders(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
    }, (error: any) => {
      console.error('Orders snapshot error:', error);
      if (error.message.includes('blocked')) setIsFirebaseBlocked(true);
    });

    const qLogs = query(collection(db, 'activity_logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      setLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog)));
    }, (error: any) => {
      console.error('Logs snapshot error:', error);
      if (error.message.includes('blocked')) setIsFirebaseBlocked(true);
    });

    const qUsers = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(qUsers, (snapshot) => {
      setUsers(snapshot.docs.map(d => d.data() as UserProfile));
    }, (error: any) => {
      console.error('Users snapshot error:', error);
      if (error.message.includes('blocked')) setIsFirebaseBlocked(true);
    });

    const qSuppliers = query(collection(db, 'supplier_orders'), orderBy('createdAt', 'desc'));
    const unsubSuppliers = onSnapshot(qSuppliers, (snapshot) => {
      setSupplierOrders(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SupplierOrder)));
    }, (error: any) => {
      console.error('Suppliers snapshot error:', error);
      if (error.message.includes('blocked')) setIsFirebaseBlocked(true);
    });

    return () => { unsubOrders(); unsubLogs(); unsubUsers(); unsubSuppliers(); };
  }, [user, profile]);

  const logActivity = async (action: string, details: string) => {
    if (!user) return;
    const path = 'activity_logs';
    try {
      await addDoc(collection(db, path), {
        userId: user.uid,
        userEmail: user.email,
        action,
        details,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleSaveOrder = async (data: any) => {
    const path = 'orders';
    try {
      if (editingOrder) {
        // Calculate changes for detailed logging
        const changes: string[] = [];
        if (editingOrder.status !== data.status) {
          changes.push(`trạng thái: ${editingOrder.status} -> ${data.status}`);
        }
        if (editingOrder.paymentStatus !== data.paymentStatus) {
          changes.push(`thanh toán: ${editingOrder.paymentStatus} -> ${data.paymentStatus}`);
          
          // Update paidAt based on paymentStatus transition
          if (data.paymentStatus === 'paid') {
            data.paidAt = serverTimestamp();
          } else {
            data.paidAt = null;
          }
        } else if (data.paymentStatus === 'paid' && !editingOrder.paidAt) {
          // Ensure paidAt is set if it was paid but paidAt was missing
          data.paidAt = serverTimestamp();
        } else {
          // Keep existing paidAt
          data.paidAt = editingOrder.paidAt || null;
        }

        if (editingOrder.paidAmount !== data.paidAmount) {
          changes.push(`số tiền trả: ${formatCurrency(editingOrder.paidAmount)} -> ${formatCurrency(data.paidAmount)}`);
        }
        if (editingOrder.totalAmount !== data.totalAmount) {
          changes.push(`tổng tiền: ${formatCurrency(editingOrder.totalAmount)} -> ${formatCurrency(data.totalAmount)}`);
        }
        if (editingOrder.vatInvoiceCode !== data.vatInvoiceCode) {
          changes.push(`mã VAT: ${editingOrder.vatInvoiceCode || 'trống'} -> ${data.vatInvoiceCode || 'trống'}`);
        }

        const details = changes.length > 0 
          ? `Đơn hàng ${editingOrder.id} (${data.customerName}). Thay đổi: ${changes.join(', ')}`
          : `Đơn hàng ${editingOrder.id} (${data.customerName}). Không có thay đổi lớn.`;

        // If production role, only update status and updatedAt to comply with security rules
        if (userRole === 'production') {
          await updateDoc(doc(db, path, editingOrder.id), {
            status: data.status,
            updatedAt: serverTimestamp()
          });
        } else {
          await updateDoc(doc(db, path, editingOrder.id), data);
        }
        
        await logActivity('cập nhật đơn hàng', details);
      } else {
        // Generate orderCode: AVP-aabbcccc
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2);
        const sequence = String(orders.length + 1).padStart(4, '0');
        const orderCode = `AVP-${month}${year}${sequence}`;

        const finalData = {
          ...data,
          orderCode,
          createdBy: user?.uid,
          createdAt: serverTimestamp(),
          paidAt: data.paymentStatus === 'paid' ? serverTimestamp() : null
        };

        const docRef = await addDoc(collection(db, path), finalData);
        await logActivity('tạo đơn hàng mới', `Đơn hàng mới ${orderCode} cho ${data.customerName}`);
      }
      setEditingOrder(null);
      navigate(-1);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    const path = 'orders';
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      await deleteDoc(doc(db, path, orderId));
      await logActivity('xóa đơn hàng', `Xóa đơn hàng ${order.orderCode || orderId} của ${order.customerName}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleSaveSupplierOrder = async (data: any) => {
    const path = 'supplier_orders';
    try {
      if (editingSupplierOrder) {
        // Update paidAt based on paymentStatus transition
        if (data.paymentStatus === 'paid' && editingSupplierOrder.paymentStatus !== 'paid') {
          data.paidAt = serverTimestamp();
        } else if (data.paymentStatus !== 'paid') {
          data.paidAt = null;
        } else {
          data.paidAt = editingSupplierOrder.paidAt || null;
        }

        await updateDoc(doc(db, path, editingSupplierOrder.id), data);
        await logActivity('cập nhật đơn mua', `Cập nhật đơn mua từ ${data.supplierName}`);
      } else {
        await addDoc(collection(db, path), {
          ...data,
          createdBy: user?.uid,
          createdAt: serverTimestamp(),
          paidAt: data.paymentStatus === 'paid' ? serverTimestamp() : null
        });
        await logActivity('tạo đơn mua mới', `Tạo đơn mua mới từ ${data.supplierName}`);
      }
      setEditingSupplierOrder(null);
      navigate(-1);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleDeleteSupplierOrder = async (id: string) => {
    const path = 'supplier_orders';
    try {
      const order = supplierOrders.find(o => o.id === id);
      await deleteDoc(doc(db, path, id));
      await logActivity('xóa đơn mua', `Xóa đơn mua từ ${order?.supplierName || id}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleUpdateUserRole = async (uid: string, role: UserRole) => {
    const path = 'users';
    try {
      await updateDoc(doc(db, path, uid), { role });
      await logActivity('cập nhật quyền hạn', `Thay đổi quyền của người dùng ${uid} thành ${role}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleApproveUser = async (uid: string) => {
    const path = 'users';
    try {
      await updateDoc(doc(db, path, uid), { isApproved: true });
      await logActivity('phê duyệt nhân viên', `Phê duyệt tài khoản nhân viên ${uid}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (uid === user?.uid) {
      alert("Bạn không thể tự xóa tài khoản của chính mình!");
      return;
    }
    
    const path = 'users';
    try {
      const userToDelete = users.find(u => u.uid === uid);
      const userEmail = userToDelete?.email || uid;
      
      const { deleteDoc } = await import('firebase/firestore');
      await deleteDoc(doc(db, path, uid));
      
      await logActivity('xóa nhân viên', `Đã xóa tài khoản nhân viên: ${userEmail}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white p-10 rounded-3xl shadow-2xl text-center space-y-8 animate-in zoom-in-95 duration-500">
          <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-indigo-100 rotate-3">
            <Printer className="w-10 h-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">PrintManager Pro</h1>
            <p className="text-slate-500 mt-2">Đăng nhập để quản lý hệ thống in ấn của bạn.</p>
          </div>
          <button 
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-lg"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Đăng nhập với Google
          </button>
          <p className="text-xs text-slate-400">Bằng cách đăng nhập, bạn đồng ý với các điều khoản dịch vụ của chúng tôi.</p>
        </div>
      </div>
    );
  }

  if (!profile?.isApproved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-slate-100 text-center space-y-6">
          <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center text-amber-500 mx-auto">
            <Clock className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900">Chờ phê duyệt</h1>
            <p className="text-slate-500">
              Tài khoản của bạn ({user.email}) đã được tạo thành công nhưng đang chờ Quản trị viên phê duyệt.
            </p>
          </div>
          <div className="bg-slate-50 p-4 rounded-2xl text-sm text-slate-600 text-left">
            <p className="font-bold mb-1">Bạn cần làm gì?</p>
            <p>Vui lòng liên hệ với Quản trị viên hệ thống để được kích hoạt tài khoản. Bạn sẽ tự động được chuyển vào hệ thống sau khi được phê duyệt.</p>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 text-slate-500 hover:text-rose-600 font-medium transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 flex">
        {isFirebaseBlocked && (
          <div className="fixed top-0 left-0 right-0 bg-rose-500 text-white p-2 text-center text-sm font-bold animate-pulse z-[9999]">
            Cảnh báo: Kết nối tới cơ sở dữ liệu bị chặn. Vui lòng tắt trình chặn quảng cáo (Ad-blocker) để ứng dụng hoạt động bình thường.
          </div>
        )}
          {/* Sidebar */}
          <aside className={cn(
            "fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-slate-100 transition-transform duration-300 lg:relative lg:translate-x-0",
            !isSidebarOpen && "-translate-x-full"
          )}>
            <div className="h-full flex flex-col p-6">
              <div className="flex items-center gap-3 mb-10 px-2">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100">
                  <Printer className="w-6 h-6 text-white" />
                </div>
                <span className="text-xl font-bold text-slate-900">PrintManager</span>
              </div>

              <nav className="flex-1 space-y-2">
                {profile?.role === 'admin' && (
                  <SidebarItem to="/" icon={LayoutDashboard} label="Tổng quan" active={location.pathname === '/'} />
                )}
                <SidebarItem to="/orders" icon={FileText} label="Đơn hàng" active={location.pathname === '/orders'} />
                
                {profile?.role !== 'production' && (
                  <>
                    <SidebarItem to="/orders/new" icon={Plus} label="Tạo đơn hàng" active={location.pathname === '/orders/new'} />
                    <SidebarItem icon={Calculator} label="Tính giá in" onClick={() => setCalculatorOpen(!isCalculatorOpen)} />
                    <SidebarItem to="/suppliers" icon={Truck} label="Nhà cung cấp" active={location.pathname.startsWith('/suppliers')} />
                  </>
                )}

                {profile?.role === 'admin' && (
                  <>
                    <SidebarItem to="/logs" icon={History} label="Lịch sử" active={location.pathname === '/logs'} />
                    <SidebarItem to="/users" icon={Users} label="Nhân sự" active={location.pathname === '/users'} />
                  </>
                )}
              </nav>

              <div className="pt-6 border-t border-slate-100">
                <div className="flex items-center gap-3 px-2 mb-6">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                    <UserIcon className="w-5 h-5 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{profile?.displayName || user.email}</p>
                    <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                      {profile?.role === 'admin' ? 'Quản trị' : profile?.role === 'production' ? 'Sản xuất' : 'Bán hàng'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-all"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="font-medium">Đăng xuất</span>
                </button>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0 overflow-hidden">
            <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 lg:hidden">
              <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-100 rounded-lg">
                {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
              <span className="font-bold text-slate-900">PrintManager</span>
              <div className="w-10" />
            </header>

            <div className="p-8 max-w-[1600px] mx-auto h-[calc(100vh-4rem)] lg:h-screen overflow-y-auto scrollbar-hide">
              <Routes>
                <Route path="/" element={
                  profile?.role === 'admin' ? <Dashboard orders={orders} supplierOrders={supplierOrders} userRole={profile?.role} users={users} /> : 
                  profile?.role === 'production' ? <Navigate to="/orders" /> : <Navigate to="/orders/new" />
                } />
                <Route path="/orders" element={
                  <OrderList 
                    orders={orders} 
                    onEdit={(o) => { setEditingOrder(o); navigate('/orders/edit'); }} 
                    onDelete={handleDeleteOrder}
                    userRole={profile?.role}
                    users={users}
                    onPrint={(order, type) => setPrintOrder({ order, type })}
                  />
                } />
                <Route path="/orders/new" element={
                  profile?.role === 'production' ? <Navigate to="/orders" /> :
                  <OrderForm orders={orders} onSave={handleSaveOrder} onCancel={() => navigate(-1)} userRole={profile?.role} onPrint={(order, type) => setPrintOrder({ order, type })} />
                } />
                <Route path="/orders/edit" element={
                  editingOrder ? (
                    <OrderForm orders={orders} initialOrder={editingOrder} onSave={handleSaveOrder} onCancel={() => { setEditingOrder(null); navigate(-1); }} userRole={profile?.role} onPrint={(order, type) => setPrintOrder({ order, type })} />
                  ) : <Navigate to="/orders" />
                } />
                <Route path="/suppliers" element={
                  profile?.role === 'production' ? <Navigate to="/orders" /> :
                  <SupplierOrderList 
                    orders={supplierOrders} 
                    onEdit={(o) => { setEditingSupplierOrder(o); navigate('/suppliers/edit'); }} 
                    onDelete={handleDeleteSupplierOrder}
                    userRole={profile?.role}
                    users={users}
                  />
                } />
                <Route path="/suppliers/new" element={
                  profile?.role === 'production' ? <Navigate to="/orders" /> :
                  <SupplierOrderForm supplierOrders={supplierOrders} onSave={handleSaveSupplierOrder} onCancel={() => navigate(-1)} userRole={profile?.role} />
                } />
                <Route path="/suppliers/edit" element={
                  editingSupplierOrder && profile?.role !== 'production' ? (
                    <SupplierOrderForm supplierOrders={supplierOrders} initialOrder={editingSupplierOrder} onSave={handleSaveSupplierOrder} onCancel={() => { setEditingSupplierOrder(null); navigate(-1); }} userRole={profile?.role} />
                  ) : <Navigate to="/suppliers" />
                } />
                <Route path="/logs" element={
                  profile?.role === 'admin' ? <ActivityLogs logs={logs} /> : <Navigate to="/orders/new" />
                } />
                {profile?.role === 'admin' && (
                  <Route path="/users" element={<UserManagement users={users} onUpdateRole={handleUpdateUserRole} onApprove={handleApproveUser} onDelete={handleDeleteUser} />} />
                )}
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </div>
          </main>
        </div>
        <AnimatePresence>
          {isCalculatorOpen && (
            <PriceCalculator 
              isFloating 
              onClose={() => setCalculatorOpen(false)} 
              userRole={profile?.role}
              paperTypes={paperTypes}
              postProcessing={postProcessing}
              printConfig={printConfig}
              onUpdatePaper={handleUpdatePaper}
              onUpdateProcessing={handleUpdateProcessing}
              onUpdateConfig={handleUpdatePrintConfig}
              isSidebarOpen={isSidebarOpen}
            />
          )}
          {printOrder && (
            <PrintModal 
              order={printOrder.order} 
              type={printOrder.type} 
              onClose={() => setPrintOrder(null)} 
            />
          )}
        </AnimatePresence>
      </ErrorBoundary>
  );
}
