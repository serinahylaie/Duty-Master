/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  addMonths, 
  subMonths, 
  isSameMonth, 
  parseISO, 
  isSaturday, 
  isSunday,
  startOfWeek,
  endOfWeek,
  isSameDay,
  getDay,
  addDays
} from 'date-fns';
import { 
  Calendar as CalendarIcon, 
  Users, 
  Settings, 
  CheckCircle2, 
  AlertCircle, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Trash2, 
  Lock, 
  Unlock,
  Wand2,
  BarChart3,
  Moon,
  Sun,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot, 
  deleteDoc, 
  writeBatch,
  OperationType,
  handleFirestoreError
} from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

import { Employee, Shift, ShiftType, ConstraintViolation, EmployeeRole } from './types';
import { solve, getViolations } from './lib/scheduler';
import { cn } from '@/lib/utils';

const INITIAL_EMPLOYEES: Employee[] = [
  { id: 'emp-1', name: '主管 A', role: 'MANAGER', leaveDates: [] },
  { id: 'emp-2', name: '主管 B', role: 'MANAGER', leaveDates: [] },
  ...Array.from({ length: 13 }, (_, i) => ({
    id: `emp-${i + 3}`,
    name: `員工 ${i + 3}`,
    role: 'STAFF' as EmployeeRole,
    leaveDates: []
  }))
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]); // Store all shifts for cross-month rules
  const [isSolving, setIsSolving] = useState(false);
  const [selectedShift, setSelectedShift] = useState<{ date: string, employeeId: string } | null>(null);
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeeRole, setNewEmployeeRole] = useState<EmployeeRole>('STAFF');
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Taiwan Holidays 2026
  const TAIWAN_HOLIDAYS_2026: Record<string, string> = {
    '2026-01-01': '元旦',
    '2026-01-02': '彈性放假',
    '2026-01-10': '補班日',
    '2026-02-16': '農曆除夕',
    '2026-02-17': '春節',
    '2026-02-18': '春節',
    '2026-02-19': '春節',
    '2026-02-20': '春節',
    '2026-02-21': '春節',
    '2026-02-28': '和平紀念日',
    '2026-04-03': '兒童節',
    '2026-04-04': '清明節',
    '2026-04-06': '補假',
    '2026-05-01': '勞動節',
    '2026-06-19': '端午節',
    '2026-09-25': '中秋節',
    '2026-10-10': '國慶日',
  };

  const isGuest = user?.isAnonymous;

  const getHoliday = (date: Date) => {
    return TAIWAN_HOLIDAYS_2026[format(date, 'yyyy-MM-dd')];
  };

  // Auth State Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
  }, []);

  // Fetch Employees
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'employees'));
    return onSnapshot(q, (snapshot) => {
      const emps = snapshot.docs.map(doc => doc.data() as Employee);
      if (emps.length === 0) {
        // Initialize with defaults if empty
        INITIAL_EMPLOYEES.forEach(async (e) => {
          await setDoc(doc(db, 'employees', e.id), e);
        });
      } else {
        setEmployees(emps);
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'employees'));
  }, [user]);

  // Fetch ALL shifts for cross-month validation
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'shifts'));
    return onSnapshot(q, (snapshot) => {
      const s = snapshot.docs.map(doc => doc.data() as Shift);
      setAllShifts(s);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'shifts'));
  }, [user]);

  // Filter shifts for current month for display
  const currentMonthShifts = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start, end });
    
    const monthShifts: Shift[] = [];
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const existingDay = allShifts.find(s => s.date === dateStr && s.type === 'DAY');
      const existingNight = allShifts.find(s => s.date === dateStr && s.type === 'NIGHT');
      
      monthShifts.push(existingDay || { date: dateStr, type: 'DAY', employeeId: null, isLocked: false });
      monthShifts.push(existingNight || { date: dateStr, type: 'NIGHT', employeeId: null, isLocked: false });
    });
    return monthShifts;
  }, [allShifts, currentMonth]);

  // Update local shifts state when currentMonthShifts changes
  useEffect(() => {
    setShifts(currentMonthShifts);
  }, [currentMonthShifts]);

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login failed:", error);
      toast.error("Google 登入失敗，請確認網域授權或嘗試其他方式");
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthenticating(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
        toast.success("帳號註冊成功");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success("登入成功");
      }
    } catch (error: any) {
      console.error("Auth failed:", error);
      let msg = "認證失敗";
      if (error.code === 'auth/user-not-found') msg = "找不到此用戶";
      if (error.code === 'auth/wrong-password') msg = "密碼錯誤";
      if (error.code === 'auth/email-already-in-use') msg = "此信箱已被註冊";
      if (error.code === 'auth/weak-password') msg = "密碼強度不足 (至少 6 位)";
      if (error.code === 'auth/invalid-email') msg = "無效的信箱格式";
      setAuthError(msg);
      toast.error(msg);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsAuthenticating(true);
    try {
      await signInAnonymously(auth);
      toast.success("以訪客身份登入");
    } catch (error: any) {
      console.error("Guest login failed:", error);
      toast.error("訪客登入失敗");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setShifts([]);
      setAllShifts([]);
      setEmployees([]);
    } catch (error) {
      toast.error("登出失敗");
    }
  };

  const saveShiftsToFirebase = async (newShifts: Shift[]) => {
    if (!user) return;
    const batch = writeBatch(db);
    newShifts.forEach(s => {
      const id = `${s.date}_${s.type}`;
      const ref = doc(db, 'shifts', id);
      batch.set(ref, s);
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'shifts');
    }
  };

  const handleAutoSchedule = async () => {
    if (!user) {
      toast.error("請先登入");
      return;
    }
    setIsSolving(true);
    toast.info("正在生成最佳班表...");
    
    setTimeout(async () => {
      const start = startOfMonth(currentMonth);
      const end = endOfMonth(currentMonth);
      // Pass ALL shifts to solve for cross-month context
      const result = solve(employees, start, end, allShifts);
      
      if (result) {
        await saveShiftsToFirebase(result);
        toast.success("班表生成成功！已儲存至雲端。");
      } else {
        toast.error("無法找到符合所有規則的排班方案。");
      }
      setIsSolving(false);
    }, 500);
  };

  const handleManualAssign = async (date: string, type: ShiftType | 'NONE', employeeId: string) => {
    if (!user) return;
    let updatedShifts = [...allShifts];
    const dateObj = parseISO(date);
    const dayOfWeek = getDay(dateObj);

    // 1. Remove existing assignments for this employee on this date
    updatedShifts = updatedShifts.filter(s => !(s.date === date && s.employeeId === employeeId));

    if (type === 'NONE') {
      const id = `${date}_DAY`; // Need to check both types
      const id2 = `${date}_NIGHT`;
      await deleteDoc(doc(db, 'shifts', id));
      await deleteDoc(doc(db, 'shifts', id2));
      setSelectedShift(null);
      return;
    }

    // 2. Check if the target shift is already taken
    const existingShift = allShifts.find(s => s.date === date && s.type === type);
    if (existingShift?.employeeId && existingShift.employeeId !== employeeId) {
      const otherEmp = employees.find(e => e.id === existingShift.employeeId);
      toast.error(`該時段已被 ${otherEmp?.name} 佔用`);
      return;
    }

    // 3. Assign new shift
    const batch = writeBatch(db);
    if (type === 'NIGHT' && dayOfWeek >= 0 && dayOfWeek <= 5) {
      const sunDate = addDays(dateObj, -dayOfWeek);
      const blockDates = Array.from({ length: 6 }, (_, i) => format(addDays(sunDate, i), 'yyyy-MM-dd'));
      
      blockDates.forEach(dStr => {
        const ref = doc(db, 'shifts', `${dStr}_NIGHT`);
        batch.set(ref, { date: dStr, type: 'NIGHT', employeeId, isContinuous: true, isLocked: false });
      });
      toast.info(`已自動填滿該週連續夜班`);
    } else {
      const ref = doc(db, 'shifts', `${date}_${type}`);
      batch.set(ref, { date, type, employeeId, isContinuous: false, isLocked: false });
    }

    try {
      await batch.commit();
      const violations = getViolations(allShifts, employees, date, type, employeeId);
      if (violations.length > 0) {
        toast.warning(`違反規則: ${violations[0].message}`);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'shifts');
    }
    setSelectedShift(null);
  };

  const handleClearUnlocked = async () => {
    if (!user) return;
    const shiftsToClear = shifts.filter(s => !s.isLocked && s.employeeId !== null);
    if (shiftsToClear.length === 0) return;

    const batch = writeBatch(db);
    shiftsToClear.forEach(s => {
      const id = `${s.date}_${s.type}`;
      batch.delete(doc(db, 'shifts', id));
    });

    try {
      await batch.commit();
      toast.success("已清除本月未鎖定的排班");
      setIsConfirmClearOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'shifts');
    }
  };

  const handleExportSchedule = () => {
    setIsExporting(true);
    try {
      const header = ['日期', '星期', '節日', '白班員工', '夜班員工'];
      const rows = daysInMonth.map(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const holiday = getHoliday(date) || '';
        const dayShift = shifts.find(s => s.date === dateStr && s.type === 'DAY');
        const nightShift = shifts.find(s => s.date === dateStr && s.type === 'NIGHT');
        
        const dayEmp = employees.find(e => e.id === dayShift?.employeeId)?.name || '';
        const nightEmp = employees.find(e => e.id === nightShift?.employeeId)?.name || '';
        
        return [
          format(date, 'yyyy/MM/dd'),
          WEEKDAYS_CHINESE[getDay(date)],
          holiday,
          dayEmp,
          nightEmp
        ];
      });

      const csvContent = [header, ...rows].map(r => r.join(',')).join('\n');
      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `排班表_${format(currentMonth, 'yyyyMM')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("排班表匯出成功");
    } catch (error) {
      toast.error("匯出失敗");
    } finally {
      setIsExporting(false);
    }
  };

  const toggleLock = async (date: string, employeeId: string) => {
    if (!user) return;
    const shift = allShifts.find(s => s.date === date && s.employeeId === employeeId);
    if (shift) {
      const ref = doc(db, 'shifts', `${shift.date}_${shift.type}`);
      await setDoc(ref, { ...shift, isLocked: !shift.isLocked });
    }
  };

  const handleAddEmployee = async () => {
    if (!user || !newEmployeeName.trim()) return;
    const id = `emp-${Date.now()}`;
    const newEmp: Employee = { id, name: newEmployeeName.trim(), role: newEmployeeRole, leaveDates: [] };
    try {
      await setDoc(doc(db, 'employees', id), newEmp);
      setNewEmployeeName('');
      setIsAddingEmployee(false);
      toast.success(`已新增員工: ${newEmp.name}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'employees');
    }
  };

  const handleDeleteEmployee = async (empId: string) => {
    if (!user) return;
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    
    const hasShifts = allShifts.some(s => s.employeeId === empId);
    if (hasShifts) {
      toast.error("該員工已有排班紀錄，無法刪除。請先清除相關排班。");
      return;
    }

    try {
      await deleteDoc(doc(db, 'employees', empId));
      toast.success(`已刪除員工: ${emp.name}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'employees');
    }
  };

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n');
      const batch = writeBatch(db);
      let count = 0;

      lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        if (index === 0 && (trimmedLine.includes('姓名') || trimmedLine.includes('name'))) return;
        
        const [name, roleStr] = trimmedLine.split(',').map(s => s.trim());
        if (name) {
          const id = `emp-${Date.now()}-${index}`;
          const role: EmployeeRole = (roleStr === '主管' || roleStr === 'MANAGER') ? 'MANAGER' : 'STAFF';
          const newEmp: Employee = { id, name, role, leaveDates: [] };
          batch.set(doc(db, 'employees', id), newEmp);
          count++;
        }
      });

      try {
        await batch.commit();
        toast.success(`成功匯入 ${count} 位員工`);
        event.target.value = ''; // Reset input
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'employees');
      }
    };
    reader.readAsText(file);
  };

  const stats = useMemo(() => {
    const monthShifts = shifts.filter(s => isSameMonth(parseISO(s.date), currentMonth));
    return employees.map(emp => {
      const empShifts = monthShifts.filter(s => s.employeeId === emp.id);
      const dayShifts = empShifts.filter(s => s.type === 'DAY');
      const nightShifts = empShifts.filter(s => s.type === 'NIGHT').length;
      
      const weekdayDayShifts = dayShifts.filter(s => {
        const d = parseISO(s.date);
        const holiday = getHoliday(d);
        const isWE = isSaturday(d) || isSunday(d);
        const isHoliday = holiday && holiday !== '補班日';
        const isMakeup = holiday === '補班日';
        return !((isWE || isHoliday) && !isMakeup);
      }).length;

      const weekendDayShifts = dayShifts.length - weekdayDayShifts;

      return {
        ...emp,
        dayShifts: dayShifts.length,
        nightShifts,
        weekdayDayShifts,
        weekendDayShifts,
        total: dayShifts.length + nightShifts
      };
    });
  }, [shifts, employees, currentMonth]);

  const yearlyStats = useMemo(() => {
    const currentYear = currentMonth.getFullYear();
    const yearShifts = allShifts.filter(s => parseISO(s.date).getFullYear() === currentYear);
    
    // Pre-calculate long holidays for the year
    const startDate = new Date(currentYear, 0, 1);
    const endDate = new Date(currentYear, 11, 31);
    const allDays = eachDayOfInterval({ start: startDate, end: endDate });
    
    const holidayBlocks: string[][] = [];
    let currentBlock: string[] = [];
    
    allDays.forEach(d => {
      const holiday = getHoliday(d);
      const isWE = isSaturday(d) || isSunday(d);
      const isHoliday = holiday && holiday !== '補班日';
      const isMakeup = holiday === '補班日';
      const isOff = (isWE || isHoliday) && !isMakeup;
      
      if (isOff) {
        currentBlock.push(format(d, 'yyyy-MM-dd'));
      } else {
        if (currentBlock.length >= 3) {
          holidayBlocks.push([...currentBlock]);
        }
        currentBlock = [];
      }
    });
    if (currentBlock.length >= 3) holidayBlocks.push(currentBlock);

    return employees.map(emp => {
      const empShifts = yearShifts.filter(s => s.employeeId === emp.id);
      
      // 1. Continuous Night Blocks
      const continuousNightBlocks = empShifts.filter(s => s.type === 'NIGHT' && s.isContinuous).length / 6;
      
      // 2. Single Night Shifts
      const singleNightShifts = empShifts.filter(s => s.type === 'NIGHT' && !s.isContinuous).length;
      
      // 3. Long Holiday Assignments
      const longHolidayAssignments = holidayBlocks.filter(block => 
        block.some(date => empShifts.some(s => s.date === date))
      ).length;

      return {
        ...emp,
        continuousNightBlocks: Math.floor(continuousNightBlocks),
        singleNightShifts,
        longHolidayAssignments
      };
    });
  }, [allShifts, employees, currentMonth]);

  const toggleRole = (empId: string) => {
    setEmployees(prev => prev.map(e => 
      e.id === empId 
        ? { ...e, role: e.role === 'MANAGER' ? 'STAFF' : 'MANAGER' } 
        : e
    ));
  };

  const daysInMonth = useMemo(() => {
    return eachDayOfInterval({
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth)
    });
  }, [currentMonth]);

  const WEEKDAYS_CHINESE = ['日', '一', '二', '三', '四', '五', '六'];

  const getShiftForEmployee = (date: string, empId: string) => {
    const dayShift = shifts.find(s => s.date === date && s.type === 'DAY');
    const nightShift = shifts.find(s => s.date === date && s.type === 'NIGHT');
    
    if (dayShift?.employeeId === empId) return { type: 'DAY' as ShiftType, shift: dayShift };
    if (nightShift?.employeeId === empId) return { type: 'NIGHT' as ShiftType, shift: nightShift };
    return null;
  };

  if (!user && isAuthReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Toaster position="top-center" />
        <Card className="w-full max-w-md shadow-xl border-gray-200">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto bg-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-2 shadow-lg shadow-indigo-200">
              <CalendarIcon size={32} />
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">Duty Master</CardTitle>
            <CardDescription>
              智慧值班排班系統 - 請登入以開始使用
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Tabs defaultValue="email" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="email">信箱登入</TabsTrigger>
                <TabsTrigger value="google">Google 登入</TabsTrigger>
              </TabsList>

              <TabsContent value="email" className="space-y-4">
                <form onSubmit={handleEmailAuth} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">電子信箱</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      placeholder="example@company.com" 
                      required 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">密碼</Label>
                    <Input 
                      id="password" 
                      type="password" 
                      placeholder="••••••••" 
                      required 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  {authError && (
                    <div className="text-red-500 text-xs flex items-center gap-1">
                      <AlertCircle size={12} />
                      {authError}
                    </div>
                  )}
                  <Button 
                    type="submit" 
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                    disabled={isAuthenticating}
                  >
                    {isAuthenticating ? "處理中..." : (isSignUp ? "註冊帳號" : "登入")}
                  </Button>
                </form>
                <div className="text-center">
                  <button 
                    className="text-xs text-indigo-600 hover:underline"
                    onClick={() => setIsSignUp(!isSignUp)}
                  >
                    {isSignUp ? "已有帳號？點此登入" : "還沒有帳號？點此註冊"}
                  </button>
                </div>
              </TabsContent>

              <TabsContent value="google" className="space-y-4">
                <Button 
                  variant="outline" 
                  className="w-full py-6 gap-3 border-gray-200 hover:bg-gray-50 text-gray-700"
                  onClick={handleGoogleLogin}
                  disabled={isAuthenticating}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  使用 Google 帳號登入
                </Button>
                <p className="text-[10px] text-gray-400 text-center">
                  * 若公司網路限制 Google 登入，請改用「信箱登入」或「訪客登入」
                </p>
              </TabsContent>
            </Tabs>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-200"></span>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-400">或</span>
              </div>
            </div>

            <Button 
              variant="ghost" 
              className="w-full text-gray-500 hover:text-indigo-600 hover:bg-indigo-50"
              onClick={handleGuestLogin}
              disabled={isAuthenticating}
            >
              訪客登入 (免帳號直接試用)
            </Button>
          </CardContent>
          <CardFooter className="bg-gray-50/50 border-t border-gray-100 py-3">
            <p className="text-[10px] text-gray-400 text-center w-full">
              © 2026 Duty Master. Secure Cloud Scheduling.
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans flex flex-col">
        <Toaster position="top-center" />
        
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg text-white">
              <CalendarIcon size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Duty Master</h1>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">智慧值班排班系統</p>
            </div>
          </div>

          <div className="flex items-center gap-4 bg-gray-50 p-1 rounded-xl border border-gray-200">
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
              <ChevronLeft size={20} />
            </Button>
            <div className="px-4 font-bold text-lg min-w-[140px] text-center">
              {format(currentMonth, 'yyyy年 MM月')}
            </div>
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight size={20} />
            </Button>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-medium text-gray-500">已登入</span>
                  <span className="text-sm font-bold text-gray-900">{user.displayName || user.email || (user.isAnonymous ? "訪客" : "用戶")}</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleLogout} className="h-8 text-xs">登出</Button>
              </div>
            )}
            <Dialog>
              <DialogTrigger render={
                <Button variant="outline" className="gap-2 border-gray-300">
                  <BarChart3 size={18} />
                  資料存儲說明
                </Button>
              } />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>資料存儲與同步說明</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 text-sm py-4">
                  <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-800">
                    <p className="font-bold mb-1">目前狀態：Firebase 雲端同步</p>
                    <p>您的資料已與 Firebase Firestore 連結，所有變更都會即時儲存至雲端。</p>
                  </div>
                  <div className="space-y-2">
                    <p className="font-bold">跨月份邏輯</p>
                    <p>系統會自動參考資料庫中所有月份的排班紀錄，確保跨月份的排班符合公平性與休養規則。</p>
                  </div>
                  <div className="space-y-2">
                    <p className="font-bold">離線使用</p>
                    <p>若失去網路連線，變更將無法儲存。請確保在網路穩定的環境下操作。</p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={isConfirmClearOpen} onOpenChange={(open) => !isGuest && setIsConfirmClearOpen(open)}>
              <DialogTrigger render={
                <Button 
                  variant="outline" 
                  className="gap-2 border-gray-200 hover:bg-red-50 hover:text-red-600 text-gray-600 transition-colors"
                  disabled={isGuest}
                >
                  <Trash2 size={18} />
                  清除未鎖定
                </Button>
              } />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-red-600">
                    <AlertCircle size={20} />
                    確認清除排班？
                  </DialogTitle>
                  <DialogDescription className="py-2">
                    此動作將刪除 <span className="font-bold text-gray-900">{format(currentMonth, 'yyyy年MM月')}</span> 所有<span className="text-red-600 font-bold">未鎖定</span>的排班紀錄。此操作無法復原。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setIsConfirmClearOpen(false)}>取消</Button>
                  <Button variant="destructive" onClick={handleClearUnlocked}>確認清除</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button 
              variant="outline"
              className="gap-2 border-gray-200 hover:bg-indigo-50 hover:text-indigo-600 text-gray-600"
              onClick={handleExportSchedule}
              disabled={isExporting}
            >
              <BarChart3 size={18} />
              匯出排班表
            </Button>
            <Button 
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-100"
              onClick={handleAutoSchedule}
              disabled={isSolving || isGuest}
            >
              {isSolving ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><Wand2 size={18} /></motion.div> : <Wand2 size={18} />}
              自動排班
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-hidden flex flex-col gap-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 overflow-hidden">
            {/* Sidebar */}
            <div className="lg:col-span-3 space-y-6 overflow-y-auto pr-2">
              <Tabs defaultValue="employees" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="employees" className="gap-2"><Users size={16} /> 員工管理</TabsTrigger>
                  <TabsTrigger value="stats" className="gap-2"><BarChart3 size={16} /> 統計數據</TabsTrigger>
                </TabsList>
                
                <TabsContent value="employees">
                  <Card className="border-gray-200 shadow-sm overflow-hidden">
                    <CardHeader className="bg-gray-50/50 pb-4">
                      <CardTitle className="text-sm font-bold flex items-center justify-between">
                        員工管理 ({employees.length})
                        <div className="flex items-center gap-1">
                          <Dialog>
                            <DialogTrigger render={
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-indigo-600">
                                <HelpCircle size={16} />
                              </Button>
                            } />
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>匯入員工 CSV 格式說明</DialogTitle>
                                <DialogDescription>
                                  請上傳符合以下格式的 CSV 檔案，系統將自動批次新增員工。
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 font-mono text-xs">
                                  <p className="text-gray-400 mb-1"># 檔案內容範例 (第一行為標題可省略)</p>
                                  <p>姓名,職位</p>
                                  <p>張小明,一般員工</p>
                                  <p>李大華,主管</p>
                                  <p>王中平,STAFF</p>
                                  <p>陳美玲,MANAGER</p>
                                </div>
                                <div className="space-y-2 text-sm">
                                  <p className="font-bold text-indigo-600">欄位說明：</p>
                                  <ul className="list-disc list-inside space-y-1 text-gray-600">
                                    <li><span className="font-medium text-gray-900">姓名</span>：員工的顯示名稱（必填）。</li>
                                    <li><span className="font-medium text-gray-900">職位</span>：可填寫「主管」、「一般員工」或英文「MANAGER」、「STAFF」。若留空預設為一般員工。</li>
                                  </ul>
                                </div>
                                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
                                  注意：匯入時會自動跳過第一行標題列（若包含「姓名」或「name」關鍵字）。
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                          <label className={cn("cursor-pointer", isGuest && "opacity-50 cursor-not-allowed")}>
                            <Input 
                              type="file" 
                              accept=".csv" 
                              className="hidden" 
                              onChange={handleImportCSV}
                              disabled={isGuest}
                            />
                            <Tooltip>
                              <TooltipTrigger render={
                                <div className={cn("p-2 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors", isGuest && "pointer-events-none")}>
                                  <BarChart3 size={18} />
                                </div>
                              } />
                              <TooltipContent>{isGuest ? "訪客無法匯入" : "匯入員工 CSV"}</TooltipContent>
                            </Tooltip>
                          </label>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-indigo-600"
                            onClick={() => !isGuest && setIsAddingEmployee(!isAddingEmployee)}
                            disabled={isGuest}
                          >
                            <Plus size={18} />
                          </Button>
                        </div>
                      </CardTitle>
                      <div className="mt-2 relative">
                        <Input 
                          placeholder="搜尋員工..." 
                          className="h-8 text-xs pl-8"
                          value={employeeSearch}
                          onChange={(e) => setEmployeeSearch(e.target.value)}
                        />
                        <Users size={14} className="absolute left-2.5 top-2 text-gray-400" />
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <AnimatePresence>
                        {isAddingEmployee && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="bg-indigo-50/50 p-4 border-b border-indigo-100 space-y-3 overflow-hidden"
                          >
                            <div className="space-y-2">
                              <Label htmlFor="emp-name" className="text-xs">員工姓名</Label>
                              <Input 
                                id="emp-name" 
                                size={32} 
                                className="h-8 text-sm" 
                                placeholder="輸入姓名..." 
                                value={newEmployeeName}
                                onChange={(e) => setNewEmployeeName(e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">職位</Label>
                              <Select 
                                value={newEmployeeRole} 
                                onValueChange={(val: EmployeeRole) => setNewEmployeeRole(val)}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="STAFF">一般員工</SelectItem>
                                  <SelectItem value="MANAGER">主管</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex gap-2 pt-1">
                              <Button size="sm" className="flex-1 h-8 text-xs bg-indigo-600" onClick={handleAddEmployee}>確認新增</Button>
                              <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => setIsAddingEmployee(false)}>取消</Button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="max-h-[400px] overflow-y-auto">
                        {employees.length === 0 ? (
                          <div className="p-8 text-center text-gray-400 text-sm">
                            尚無員工資料
                          </div>
                        ) : (
                          employees
                            .filter(e => e.name.toLowerCase().includes(employeeSearch.toLowerCase()))
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((emp) => (
                            <div key={emp.id} className="flex items-center justify-between p-3 border-b border-gray-100 hover:bg-indigo-50/30 transition-colors group">
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                                  emp.role === 'MANAGER' ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                                )}>
                                  {emp.name.charAt(0)}
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">{emp.name}</span>
                                  <span className="text-[10px] text-gray-500">{emp.role === 'MANAGER' ? '主管' : '員工'}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Tooltip>
                                  <TooltipTrigger render={
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className={cn("h-8 w-8", emp.role === 'MANAGER' ? "text-amber-600" : "text-gray-400")}
                                      onClick={() => !isGuest && toggleRole(emp.id)}
                                      disabled={isGuest}
                                    >
                                      <Settings size={14} />
                                    </Button>
                                  } />
                                  <TooltipContent>{isGuest ? "訪客無法編輯" : "切換職位"}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger render={
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                                      onClick={() => !isGuest && handleDeleteEmployee(emp.id)}
                                      disabled={isGuest}
                                    >
                                      <Trash2 size={14} />
                                    </Button>
                                  } />
                                  <TooltipContent>{isGuest ? "訪客無法刪除" : "刪除員工"}</TooltipContent>
                                </Tooltip>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="stats">
                  <Tabs defaultValue="monthly" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 mb-2 h-8">
                      <TabsTrigger value="monthly" className="text-[10px]">月統計</TabsTrigger>
                      <TabsTrigger value="yearly" className="text-[10px]">年統計 ({currentMonth.getFullYear()})</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="monthly">
                      <Card className="border-gray-200 shadow-sm">
                        <CardContent className="p-0">
                          <Table>
                            <TableHeader className="bg-gray-50">
                              <TableRow>
                                <TableHead className="text-[10px] font-bold px-2">姓名</TableHead>
                                <TableHead className="text-[10px] font-bold text-center px-1">平日日</TableHead>
                                <TableHead className="text-[10px] font-bold text-center px-1">假日日</TableHead>
                                <TableHead className="text-[10px] font-bold text-center px-1">夜班</TableHead>
                                <TableHead className="text-[10px] font-bold text-center px-1">總計</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {stats.sort((a, b) => b.total - a.total).map(emp => (
                                <TableRow key={emp.id} className="hover:bg-gray-50">
                                  <TableCell className="py-2 text-xs font-medium px-2">{emp.name}</TableCell>
                                  <TableCell className="py-2 text-xs text-center px-1">{emp.weekdayDayShifts}</TableCell>
                                  <TableCell className="py-2 text-xs text-center px-1">{emp.weekendDayShifts}</TableCell>
                                  <TableCell className="py-2 text-xs text-center px-1">{emp.nightShifts}</TableCell>
                                  <TableCell className="py-2 text-xs text-center font-bold px-1">{emp.total}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="yearly">
                      <Card className="border-gray-200 shadow-sm">
                        <CardContent className="p-0">
                          <Table>
                            <TableHeader className="bg-gray-50">
                              <TableRow>
                                <TableHead className="text-[10px] font-bold px-2">姓名</TableHead>
                                <TableHead className="text-[10px] font-bold text-center px-1">連夜(次)</TableHead>
                                <TableHead className="text-[10px] font-bold text-center px-1">單夜(次)</TableHead>
                                <TableHead className="text-[10px] font-bold text-center px-1">連假值(次)</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {yearlyStats.sort((a, b) => (b.continuousNightBlocks + b.singleNightShifts) - (a.continuousNightBlocks + a.singleNightShifts)).map(emp => (
                                <TableRow key={emp.id} className="hover:bg-gray-50">
                                  <TableCell className="py-2 text-xs font-medium px-2">{emp.name}</TableCell>
                                  <TableCell className="py-2 text-xs text-center px-1">{emp.continuousNightBlocks}</TableCell>
                                  <TableCell className="py-2 text-xs text-center px-1">{emp.singleNightShifts}</TableCell>
                                  <TableCell className="py-2 text-xs text-center px-1">{emp.longHolidayAssignments}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          <div className="p-2 text-[9px] text-gray-400 italic">
                            * 連假值班：指 3 天以上連續假日中有被排班的次數
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                </TabsContent>
              </Tabs>

              <Card className="border-gray-200 shadow-sm bg-indigo-900 text-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Settings size={16} /> 排班規則說明</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-[11px] opacity-90">
                  <div className="flex gap-2"><CheckCircle2 size={12} className="shrink-0 text-indigo-300" /><p>禁止連續 7 天上班 (週末僅能擇一)</p></div>
                  <div className="flex gap-2"><CheckCircle2 size={12} className="shrink-0 text-indigo-300" /><p>連續夜班：週日至週五 (N)</p></div>
                  <div className="flex gap-2"><CheckCircle2 size={12} className="shrink-0 text-indigo-300" /><p>單日夜班：週六 (N)</p></div>
                  <div className="flex gap-2"><CheckCircle2 size={12} className="shrink-0 text-indigo-300" /><p>避免連續兩天排日班 (D)</p></div>
                  <div className="flex gap-2"><CheckCircle2 size={12} className="shrink-0 text-indigo-300" /><p>主管僅輪替假日日班</p></div>
                </CardContent>
              </Card>
            </div>

            {/* Grid View */}
            <div className="lg:col-span-9 flex flex-col overflow-hidden bg-white rounded-xl border border-gray-200 shadow-md">
              <div className="overflow-auto flex-1 relative">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-20 bg-gray-50 shadow-sm">
                    <tr>
                      <th className="sticky left-0 z-30 bg-gray-100 border-b border-r border-gray-200 p-2 min-w-[100px] text-left font-bold">姓名</th>
                      {daysInMonth.map(date => {
                        const holiday = getHoliday(date);
                        const isWE = isSaturday(date) || isSunday(date);
                        const isHoliday = holiday && holiday !== '補班日';
                        const isMakeup = holiday === '補班日';
                        const isToday = isSameDay(date, new Date());
                        
                        return (
                          <th key={date.toISOString()} className={cn(
                            "border-b border-r border-gray-200 p-1 min-w-[45px] text-center font-bold relative",
                            (isWE || isHoliday) ? "text-red-500 bg-red-50/50" : "text-gray-600",
                            isMakeup && "bg-blue-50/30 text-blue-600",
                            isToday && "bg-amber-50 ring-2 ring-inset ring-amber-400 z-10"
                          )}>
                            <div className="text-[10px]">{format(date, 'M/d')}</div>
                            <div className="text-xs">{WEEKDAYS_CHINESE[getDay(date)]}</div>
                            {holiday && <div className={cn(
                              "text-[8px] font-normal leading-tight",
                              isMakeup ? "text-blue-500" : "text-red-400"
                            )}>{holiday}</div>}
                            {isToday && <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-amber-500 rounded-full" />}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => (
                      <tr key={emp.id} className="hover:bg-indigo-50/20 transition-colors">
                        <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 p-2 font-medium shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                              emp.role === 'MANAGER' ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                            )}>
                              {emp.name.charAt(0)}
                            </div>
                            <span>{emp.name}</span>
                          </div>
                        </td>
                        {daysInMonth.map(date => {
                          const dateStr = format(date, 'yyyy-MM-dd');
                          const shiftInfo = getShiftForEmployee(dateStr, emp.id);
                          const violations = shiftInfo ? getViolations(allShifts, employees, dateStr, shiftInfo.type, emp.id) : [];
                          const hasViolations = violations.length > 0;
                          const holiday = getHoliday(date);
                          const isWE = isSaturday(date) || isSunday(date);
                          const isHoliday = holiday && holiday !== '補班日';
                          const isMakeup = holiday === '補班日';

                          return (
                            <td 
                              key={dateStr} 
                              className={cn(
                                "border-b border-r border-gray-200 p-0 h-10 text-center relative cursor-pointer group/cell",
                                (isWE || isHoliday) && "bg-red-50/20",
                                isMakeup && "bg-blue-50/10"
                              )}
                              onClick={() => setSelectedShift({ date: dateStr, employeeId: emp.id })}
                            >
                              {shiftInfo && (
                                <div className={cn(
                                  "w-full h-full flex items-center justify-center font-bold text-sm transition-all",
                                  shiftInfo.type === 'DAY' ? "text-orange-600 bg-orange-50/50" : "text-indigo-600 bg-indigo-50/50",
                                  hasViolations && "bg-red-100 text-red-700",
                                  shiftInfo.shift.isLocked && "ring-1 ring-inset ring-indigo-400",
                                  shiftInfo.shift.isContinuous && "border-b-2 border-indigo-400"
                                )}>
                                  {shiftInfo.type === 'DAY' ? 'D' : 'N'}
                                  
                                  {hasViolations && (
                                    <div className="absolute top-0 right-0">
                                      <AlertCircle size={10} className="text-red-500" />
                                    </div>
                                  )}
                                  
                                  {shiftInfo.shift.isLocked && (
                                    <div className="absolute bottom-0.5 right-0.5">
                                      <Lock size={8} className="text-indigo-400" />
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              <div className="absolute inset-0 opacity-0 group-hover/cell:opacity-100 bg-black/5 flex items-center justify-center pointer-events-none">
                                <Plus size={12} className="text-gray-400" />
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Legend */}
              <div className="p-3 bg-gray-50 border-t border-gray-200 flex items-center gap-6 text-[10px] font-medium text-gray-500">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-orange-100 border border-orange-200 rounded flex items-center justify-center text-orange-600 font-bold">D</div> 日班 (Day)</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-indigo-100 border border-indigo-200 rounded flex items-center justify-center text-indigo-600 font-bold">N</div> 夜班 (Night)</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 border border-gray-300 rounded flex items-center justify-center"><Lock size={8} /></div> 已鎖定</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-indigo-400"></div> 連續夜班區塊</div>
                <div className="ml-auto text-gray-400 italic">點擊儲存格可手動指派或調整</div>
              </div>
            </div>
          </div>
        </main>

        {/* Manual Edit Dialog */}
        <Dialog open={!!selectedShift} onOpenChange={(open) => !open && setSelectedShift(null)}>
          <DialogContent className="sm:max-w-[350px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings size={20} className="text-indigo-600" />
                {selectedShift && employees.find(e => e.id === selectedShift.employeeId)?.name}
              </DialogTitle>
              <CardDescription>
                {selectedShift && format(parseISO(selectedShift.date), 'M/dd (EEEE)', { locale: undefined })} 
                {selectedShift && getHoliday(parseISO(selectedShift.date)) && 
                  <span className="text-red-500 ml-2">[{getHoliday(parseISO(selectedShift.date))}]</span>
                }
              </CardDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              {isGuest && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs flex items-center gap-2 mb-2">
                  <AlertCircle size={14} />
                  訪客模式僅供瀏覽，無法修改班表。
                </div>
              )}
              <div className="grid grid-cols-1 gap-3">
                <Button 
                  variant={getShiftForEmployee(selectedShift?.date || '', selectedShift?.employeeId || '')?.type === 'DAY' ? 'default' : 'outline'}
                  className={cn("justify-start gap-3 h-12", getShiftForEmployee(selectedShift?.date || '', selectedShift?.employeeId || '')?.type === 'DAY' && "bg-orange-600 hover:bg-orange-700")}
                  onClick={() => selectedShift && handleManualAssign(selectedShift.date, 'DAY', selectedShift.employeeId)}
                  disabled={isGuest}
                >
                  <Sun size={18} /> 日班 (D)
                </Button>
                <Button 
                  variant={getShiftForEmployee(selectedShift?.date || '', selectedShift?.employeeId || '')?.type === 'NIGHT' ? 'default' : 'outline'}
                  className={cn("justify-start gap-3 h-12", getShiftForEmployee(selectedShift?.date || '', selectedShift?.employeeId || '')?.type === 'NIGHT' && "bg-indigo-600 hover:bg-indigo-700")}
                  onClick={() => selectedShift && handleManualAssign(selectedShift.date, 'NIGHT', selectedShift.employeeId)}
                  disabled={isGuest}
                >
                  <Moon size={18} /> 夜班 (N)
                </Button>
                <Button 
                  variant="ghost"
                  className="justify-start gap-3 h-12 text-gray-500"
                  onClick={() => selectedShift && handleManualAssign(selectedShift.date, 'NONE', selectedShift.employeeId)}
                  disabled={isGuest}
                >
                  <Trash2 size={18} /> 清除排班
                </Button>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <Checkbox 
                  id="lock-shift" 
                  checked={shifts.find(s => s.date === selectedShift?.date && s.employeeId === selectedShift?.employeeId)?.isLocked}
                  onCheckedChange={() => selectedShift && toggleLock(selectedShift.date, selectedShift.employeeId)}
                  disabled={isGuest}
                />
                <Label htmlFor="lock-shift" className="text-sm">鎖定此排班 (自動排班時不變動)</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" className="w-full" onClick={() => setSelectedShift(null)}>關閉</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
