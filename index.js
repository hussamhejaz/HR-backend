// server/server.js
const express = require("express");
const cors    = require("cors");

// Admin SDK (real-time DB)
const { db } = require("./config/firebaseAdmin");

// Route modules
const employeesRoutes    = require("./routes/employees");
const departmentsRoutes  = require("./routes/departments");
const teamsRoutes        = require("./routes/teams");
const jobsRoutes         = require("./routes/jobs");
const applicantsRoutes   = require("./routes/applicants");
const interviewsRoutes   = require("./routes/interviews");
const offersRoutes       = require("./routes/offers");
const timeTrackingRoutes = require("./routes/timeTracking");
const leaveRoutes        = require("./routes/leaveRequests");
const holidayRoutes      = require("./routes/holidayCalendar");
const shiftRoutes        = require("./routes/shiftSchedules");
const gradesRoutes       = require("./routes/salaryGrades");
const payslipsRoutes     = require("./routes/payslips");
const adjustmentsRoutes  = require("./routes/adjustments");
const reviewsRoutes      = require("./routes/reviews");
const goalsRoutes        = require("./routes/goals");
const feedbackRoutes     = require("./routes/feedback");
const coursesRoutes      = require("./routes/courses");
const enrollmentsRoutes  = require("./routes/enrollments");
const certificationsRoutes = require("./routes/certifications");
const turnoverRoutes       = require("./routes/turnoverReport");
const diversityRoutes      = require("./routes/diversityMetrics");
const customReportsRoutes  = require("./routes/customReports");
const rolesRoutes         = require("./routes/roles");
const companyRoutes       = require("./routes/companySettings");
const leavePoliciesRoutes = require("./routes/leavePolicies");
const integrationsRoutes  = require("./routes/integrations");

const app = express();
app.use(cors());
app.use(express.json());

// Employees
app.use("/api/employees",   employeesRoutes);

// Departments & Teams
app.use("/api/departments", departmentsRoutes);
app.use("/api/teams",       teamsRoutes);

// Recruitment
app.use("/api/recruitment/jobs",       jobsRoutes);
app.use("/api/recruitment/applicants", applicantsRoutes);
app.use("/api/recruitment/interviews", interviewsRoutes);
app.use("/api/recruitment/offers",     offersRoutes);

// Attendance & Leave
app.use("/api/attendance/timesheets", timeTrackingRoutes);
app.use("/api/attendance/leave",      leaveRoutes);
app.use("/api/attendance/holidays",   holidayRoutes);
app.use("/api/attendance/shifts",     shiftRoutes);

// Payroll & Compensation
app.use("/api/payroll/grades",      gradesRoutes);
app.use("/api/payroll/payslips",    payslipsRoutes);
app.use("/api/payroll/adjustments", adjustmentsRoutes);

// Performance
app.use("/api/performance/reviews",  reviewsRoutes);
app.use("/api/performance/goals",    goalsRoutes);
app.use("/api/performance/feedback", feedbackRoutes);

// Learning & Development
app.use("/api/learning/courses",       coursesRoutes);
app.use("/api/learning/enrollments",   enrollmentsRoutes);
app.use("/api/learning/certifications", certificationsRoutes);

// Reports & Analytics
app.use("/api/reports/turnover", diversityRoutes);
app.use("/api/reports/diversity", diversityRoutes);
app.use("/api/reports/custom",    customReportsRoutes);

// Administration
app.use("/api/admin/roles",             rolesRoutes);
app.use("/api/admin/company",           companyRoutes);
app.use("/api/admin/leave-policies",    leavePoliciesRoutes);
app.use("/api/admin/integrations",      integrationsRoutes);

const PORT = process.env.PORT || 5002;
app.listen(PORT, () =>
  console.log(`HR server running on http://localhost:${PORT}`)
);





