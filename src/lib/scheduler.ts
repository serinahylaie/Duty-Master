import { 
  addDays, 
  format, 
  isSameDay, 
  isSaturday, 
  isSunday, 
  parseISO, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval,
  getDay,
  isMonday,
  isSameMonth
} from 'date-fns';
import { Employee, Shift, ShiftType, ConstraintViolation } from '../types';

export const VALID_RULES = {
  MAX_CONSECUTIVE_DAYS: 6, // Cannot work 7 days in a row
  MAX_CONTINUOUS_NIGHT_SHIFTS: 1,
};

export function getViolations(
  shifts: Shift[], 
  employees: Employee[], 
  targetDate: string, 
  targetType: ShiftType, 
  employeeId: string
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const targetDateObj = parseISO(targetDate);
  const employee = employees.find(e => e.id === employeeId);
  const weekStart = addDays(targetDateObj, -getDay(targetDateObj));

  if (!employee) return [];

  // 1. One shift per day for the same employee
  const sameDayOtherShift = shifts.find(s => s.date === targetDate && s.type !== targetType && s.employeeId === employeeId);
  if (sameDayOtherShift) {
    violations.push({ date: targetDate, type: targetType, employeeId, message: "同一人當天不能排兩班" });
  }

  // 2. Max consecutive days (6) - "禁止連續7天上班"
  // 考慮到週一到週五是正常上班，這意味著如果週末有排班，就會增加連續上班天數。
  // 規則：如果有人在週末兩天都排班，則會變成：週一至週五(5) + 週六(1) + 週日(1) + 下週一至週五(5) = 12天連續。
  // 因此，為了符合「不連續上班超過6天」，一個人在週末（六、日）最多只能排一天（日班或夜班）。
  
  // 檢查該員工在目標日期所屬的「週末塊」是否已經有排班
  const isWeekend = isSaturday(targetDateObj) || isSunday(targetDateObj);
  if (isWeekend) {
    const otherWeekendDay = isSaturday(targetDateObj) ? addDays(targetDateObj, 1) : addDays(targetDateObj, -1);
    const otherWeekendDayStr = format(otherWeekendDay, 'yyyy-MM-dd');
    
    const hasOtherWeekendShift = shifts.some(s => 
      s.date === otherWeekendDayStr && s.employeeId === employeeId
    );
    
    if (hasOtherWeekendShift) {
      violations.push({ 
        date: targetDate, 
        type: targetType, 
        employeeId, 
        message: "因平日正常上班，週末兩天不可同時排班（否則將連續上班超過 6 天）" 
      });
    }
  }

  // 3. Weekend Fairness: No consecutive weekends
  if (isSaturday(targetDateObj) || isSunday(targetDateObj)) {
    const prevSat = addDays(targetDateObj, isSaturday(targetDateObj) ? -7 : -8);
    const prevSun = addDays(targetDateObj, isSaturday(targetDateObj) ? -6 : -7);
    const hasPrevWeekend = shifts.some(s => 
      (s.date === format(prevSat, 'yyyy-MM-dd') || s.date === format(prevSun, 'yyyy-MM-dd')) && 
      s.employeeId === employeeId
    );
    
    const nextSat = addDays(targetDateObj, isSaturday(targetDateObj) ? 7 : 6);
    const nextSun = addDays(targetDateObj, isSaturday(targetDateObj) ? 8 : 7);
    const hasNextWeekend = shifts.some(s => 
      (s.date === format(nextSat, 'yyyy-MM-dd') || s.date === format(nextSun, 'yyyy-MM-dd')) && 
      s.employeeId === employeeId
    );

    if (hasPrevWeekend || hasNextWeekend) {
      violations.push({ date: targetDate, type: targetType, employeeId, message: "禁止連續兩個週末值班" });
    }
  }

  // 4. Avoid consecutive Day Shifts
  if (targetType === 'DAY') {
    const prevDay = format(addDays(targetDateObj, -1), 'yyyy-MM-dd');
    const nextDay = format(addDays(targetDateObj, 1), 'yyyy-MM-dd');
    const hasAdjacentDayShift = shifts.some(s => 
      (s.date === prevDay || s.date === nextDay) && 
      s.type === 'DAY' && 
      s.employeeId === employeeId
    );
    if (hasAdjacentDayShift) {
      violations.push({ date: targetDate, type: targetType, employeeId, message: "避免連續兩天排日班" });
    }
  }

  // 5. Night Shift Limit: If has continuous night shift, no more night shifts this month
  if (targetType === 'NIGHT') {
    const monthShifts = shifts.filter(s => 
      isSameMonth(parseISO(s.date), targetDateObj) && 
      s.type === 'NIGHT' && 
      s.employeeId === employeeId &&
      s.date !== targetDate // Don't count self
    );
    
    // 檢查是否已經有「不同週」的連續夜班
    const targetSun = format(addDays(targetDateObj, -getDay(targetDateObj)), 'yyyy-MM-dd');
    const hasContinuousInOtherWeek = monthShifts.some(s => {
      if (!s.isContinuous) return false;
      const sSun = format(addDays(parseISO(s.date), -getDay(parseISO(s.date))), 'yyyy-MM-dd');
      return sSun !== targetSun;
    });

    if (hasContinuousInOtherWeek) {
      violations.push({ date: targetDate, type: targetType, employeeId, message: "當月已有連續夜班，不可再排其他週的夜班" });
    }
  }

  // 6. Rest Period: After Night Shift, no Day Shift on following Monday
  if (targetType === 'DAY' && isMonday(targetDateObj)) {
    const last7Days = Array.from({ length: 7 }, (_, i) => format(addDays(targetDateObj, -(i + 1)), 'yyyy-MM-dd'));
    const hadRecentNightShift = shifts.some(s => s.type === 'NIGHT' && s.employeeId === employeeId && last7Days.includes(s.date));
    
    if (hadRecentNightShift) {
      violations.push({ date: targetDate, type: targetType, employeeId, message: "夜班結束後的隔週一禁止排日班" });
    }
  }

  // 7. One shift per weekday block: Max 1 assignment period between Mon-Fri
  // A continuous block (Sun-Fri) counts as one assignment.
  const isWeekday = getDay(targetDateObj) >= 1 && getDay(targetDateObj) <= 5;
  if (isWeekday) {
    const monToFriDates = Array.from({ length: 5 }, (_, i) => format(addDays(weekStart, i + 1), 'yyyy-MM-dd'));
    const otherWeekdayShifts = shifts.filter(s => 
      monToFriDates.includes(s.date) && 
      s.employeeId === employeeId && 
      (s.date !== targetDate || s.type !== targetType)
    );

    if (otherWeekdayShifts.length > 0) {
      // If we are assigning a block, it's okay if other shifts are also part of the SAME block
      const isTargetPartOfBlock = targetType === 'NIGHT' && getDay(targetDateObj) >= 1 && getDay(targetDateObj) <= 5;
      const allOtherShiftsAreNightBlock = otherWeekdayShifts.every(s => 
        s.type === 'NIGHT' && getDay(parseISO(s.date)) >= 1 && getDay(parseISO(s.date)) <= 5
      );

      if (!(isTargetPartOfBlock && allOtherShiftsAreNightBlock)) {
        violations.push({ date: targetDate, type: targetType, employeeId, message: "週一至週五期間僅能排一次班 (連續夜班除外)" });
      }
    }
  }

  // 8. Weekend after Night Shift block: No weekend shifts if worked Sun-Fri block
  // Note: Sunday (Day 0) is the START of the block, Saturday (Day 6) is the END.
  const isTargetWeekend = isSaturday(targetDateObj) || isSunday(targetDateObj);
  if (isTargetWeekend) {
    const sunOfThisWeek = format(weekStart, 'yyyy-MM-dd');
    const hasBlockInThisWeek = shifts.some(s => 
      s.date === sunOfThisWeek && s.type === 'NIGHT' && s.employeeId === employeeId && s.isContinuous
    );
    if (hasBlockInThisWeek) {
      // Sunday Night is part of the block, so it's allowed. 
      // Sunday Day and Saturday (Day/Night) are NOT part of the block and should be blocked.
      const isSundayNightBlock = targetType === 'NIGHT' && getDay(targetDateObj) === 0;
      if (!isSundayNightBlock) {
        violations.push({ date: targetDate, type: targetType, employeeId, message: "連續夜班後的週末不排班" });
      }
    }
  }

  // 9. Role Constraints: 主管只會輪替假日日班
  if (employee.role === 'MANAGER') {
    const isWeekend = isSaturday(targetDateObj) || isSunday(targetDateObj);
    if (targetType === 'NIGHT') {
      violations.push({ date: targetDate, type: targetType, employeeId, message: "主管不排夜班" });
    } else if (!isWeekend) {
      violations.push({ date: targetDate, type: targetType, employeeId, message: "主管僅排假日日班" });
    }
  }

  // 6. Leave dates
  if (employee.leaveDates.some(ld => ld === targetDate)) {
    violations.push({ date: targetDate, type: targetType, employeeId, message: "員工當天預約休假" });
  }

  return violations;
}

export function solve(
  employees: Employee[], 
  startDate: Date, 
  endDate: Date, 
  contextShifts: Shift[] = []
): Shift[] | null {
  const targetMonthDates = eachDayOfInterval({ start: startDate, end: endDate }).map(d => format(d, 'yyyy-MM-dd'));
  
  // Create a working copy of all shifts
  // We start with contextShifts, but we need to make sure target month shifts exist
  let workingShifts = [...contextShifts];

  targetMonthDates.forEach(date => {
    if (!workingShifts.find(s => s.date === date && s.type === 'DAY')) {
      workingShifts.push({ date, type: 'DAY', employeeId: null, isLocked: false });
    }
    if (!workingShifts.find(s => s.date === date && s.type === 'NIGHT')) {
      workingShifts.push({ date, type: 'NIGHT', employeeId: null, isLocked: false });
    }
  });

  // Identify shifts that belong to the target month AND are not locked
  const shiftsToSolve = workingShifts.filter(s => 
    targetMonthDates.includes(s.date) && !s.isLocked
  );

  // Sort shifts to solve: 
  // 1. Night blocks (Sun-Fri)
  // 2. Saturday Night
  // 3. Weekend Day
  // 4. Weekday Day
  const sortedShiftsToSolve = [...shiftsToSolve].sort((a, b) => {
    const dateA = parseISO(a.date);
    const dateB = parseISO(b.date);
    const dayA = getDay(dateA);
    const dayB = getDay(dateB);
    
    // Night shifts first
    if (a.type !== b.type) return a.type === 'NIGHT' ? -1 : 1;
    
    if (a.type === 'NIGHT') {
      // Sun-Fri blocks first
      const isBlockA = dayA >= 0 && dayA <= 5;
      const isBlockB = dayB >= 0 && dayB <= 5;
      if (isBlockA !== isBlockB) return isBlockA ? -1 : 1;
    } else {
      // Day shifts: Weekend first
      const isWEA = isSaturday(dateA) || isSunday(dateA);
      const isWEB = isSaturday(dateB) || isSunday(dateB);
      if (isWEA !== isWEB) return isWEA ? -1 : 1;
    }
    
    return a.date.localeCompare(b.date);
  });

  const employeeNightBlockCount = new Map<string, number>();
  const employeeShiftCount = new Map<string, number>();
  
  employees.forEach(e => {
    // Count existing blocks in the target month
    const existingBlocks = workingShifts.filter(s => 
      isSameMonth(parseISO(s.date), startDate) && 
      s.employeeId === e.id && 
      s.isContinuous && 
      s.type === 'NIGHT'
    ).length;
    employeeNightBlockCount.set(e.id, existingBlocks > 0 ? 1 : 0);
    
    // Initial shift count for the target month (including locked ones)
    const count = workingShifts.filter(s => 
      targetMonthDates.includes(s.date) && s.employeeId === e.id
    ).length;
    employeeShiftCount.set(e.id, count);
  });

  function backtrack(index: number): boolean {
    if (index === sortedShiftsToSolve.length) return true;

    const currentShift = sortedShiftsToSolve[index];
    if (currentShift.employeeId) return backtrack(index + 1);

    // Sort employees by current shift count to prioritize those with fewer shifts (Fairness)
    const sortedEmployees = [...employees].sort((a, b) => {
      const countA = employeeShiftCount.get(a.id) || 0;
      const countB = employeeShiftCount.get(b.id) || 0;
      if (countA !== countB) return countA - countB;
      return Math.random() - 0.5; // Randomize if counts are equal
    });

    for (const emp of sortedEmployees) {
      const dateObj = parseISO(currentShift.date);
      const dayOfWeek = getDay(dateObj);

      // Handle Night Block (Sun-Fri)
      if (currentShift.type === 'NIGHT' && dayOfWeek >= 0 && dayOfWeek <= 5) {
        const hasAnyNight = workingShifts.some(s => 
          s.type === 'NIGHT' && 
          s.employeeId === emp.id && 
          isSameMonth(parseISO(s.date), dateObj)
        );
        if (hasAnyNight) continue;

        if (tryAssignNightBlock(index, emp.id)) return true;
        continue; 
      }

      // Try single shift
      const violations = getViolations(workingShifts, employees, currentShift.date, currentShift.type, emp.id);
      if (violations.length === 0) {
        currentShift.employeeId = emp.id;
        employeeShiftCount.set(emp.id, (employeeShiftCount.get(emp.id) || 0) + 1);
        
        if (backtrack(index + 1)) return true;
        
        currentShift.employeeId = null;
        employeeShiftCount.set(emp.id, (employeeShiftCount.get(emp.id) || 0) - 1);
      }
    }

    return false;
  }

  function tryAssignNightBlock(index: number, empId: string): boolean {
    const currentShift = sortedShiftsToSolve[index];
    const dateObj = parseISO(currentShift.date);
    const dayOfWeek = getDay(dateObj);

    const sunDate = addDays(dateObj, -dayOfWeek);
    const blockDates: string[] = [];
    for (let i = 0; i < 6; i++) {
      blockDates.push(format(addDays(sunDate, i), 'yyyy-MM-dd'));
    }

    if ((employeeNightBlockCount.get(empId) || 0) >= VALID_RULES.MAX_CONTINUOUS_NIGHT_SHIFTS) return false;

    const blockShifts: Shift[] = [];
    for (const dStr of blockDates) {
      const s = workingShifts.find(sh => sh.date === dStr && sh.type === 'NIGHT');
      if (!s) continue;
      if ((s.isLocked && s.employeeId !== empId) || (s.employeeId && s.employeeId !== empId)) return false;
      
      const originalId = s.employeeId;
      s.employeeId = empId;
      const violations = getViolations(workingShifts, employees, dStr, 'NIGHT', empId);
      s.employeeId = originalId;
      
      if (violations.length > 0) return false;
      blockShifts.push(s);
    }

    blockShifts.forEach(s => {
      s.employeeId = empId;
      s.isContinuous = true;
    });
    employeeNightBlockCount.set(empId, (employeeNightBlockCount.get(empId) || 0) + 1);
    employeeShiftCount.set(empId, (employeeShiftCount.get(empId) || 0) + blockShifts.length);

    if (backtrack(index + 1)) return true;

    blockShifts.forEach(s => {
      s.employeeId = null;
      s.isContinuous = false;
    });
    employeeNightBlockCount.set(empId, (employeeNightBlockCount.get(empId) || 0) - 1);
    employeeShiftCount.set(empId, (employeeShiftCount.get(empId) || 0) - blockShifts.length);
    
    return false;
  }

  if (backtrack(0)) {
    // Return ONLY the shifts for the target month
    return workingShifts.filter(s => targetMonthDates.includes(s.date));
  }
  return null;
}
