// server/server.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const employeesRoutes    = require("./routes/employees");
const departmentsRoutes  = require("./routes/departments");
const teamsRoutes        = require("./routes/teams");
const jobsRouter         = require("./routes/jobs");
const applicantsRoutes   = require("./routes/applicants");
const interviewsRoutes   = require("./routes/interviews");
const offersRoutes       = require("./routes/offers");
const gradesRoutes       = require("./routes/salaryGrades");
const payslipsRoutes     = require("./routes/payslips");
const adjustmentsRoutes  = require("./routes/adjustments");
const reviewsRoutes      = require("./routes/reviews");
const goalsRoutes        = require("./routes/goals");
const feedbackRoutes     = require("./routes/feedback");
const coursesRoutes      = require("./routes/courses");
const enrollmentsRoutes  = require("./routes/enrollments");
const certificationsRoutes = require("./routes/certifications");
const diversityRoutes      = require("./routes/diversityMetrics");
const customReportsRoutes  = require("./routes/customReports");
const rolesRoutes         = require("./routes/roles");
const companyRoutes       = require("./routes/companySettings");
const leavePoliciesRoutes = require("./routes/leavePolicies");
const integrationsRoutes  = require("./routes/integrations");
const offboardingRoutes   = require("./routes/offboarding");
const tenantsRoutes       = require("./routes/tenants");

const publicRoutes        = require("./routes/public");
const publicRecruitment   = require("./routes/publicRecruitment");
const authRoutes          = require("./routes/auth");
const shiftsRoutes = require("./routes/shiftSchedules");
const attendanceRoutes = require("./routes/attendance");


const app = express();

// CORS (single, consolidated)
const ORIGINS = [
  "http://localhost:3000",
  "https://hr-backend-npbd.onrender.com",
  process.env.WEB_ORIGIN,
  process.env.MOBILE_WEB_ORIGIN,
].filter(Boolean);

app.use(cors({
  origin: ORIGINS,
  credentials: true, // allow cookies
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","x-tenant-id","X-Tenant-Id","X-Id-Token"],
}));

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// Public API auth (mobile/web)
app.use("/api/auth", authRoutes);

// Employees (dashboard)
app.use("/api/employees",   employeesRoutes);

// Departments & Teams (dashboard)
app.use("/api/departments", departmentsRoutes);
app.use("/api/teams",       teamsRoutes);

// Recruitment (dashboard/private)
app.use("/api/recruitment/jobs", jobsRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/recruitment/applicants", applicantsRoutes);
app.use("/api/recruitment/interviews", interviewsRoutes);
app.use("/api/recruitment/offers",     offersRoutes);

// Payroll & Compensation (dashboard)
app.use("/api/payroll/grades",      gradesRoutes);
app.use("/api/payroll/payslips",    payslipsRoutes);
app.use("/api/payroll/adjustments", adjustmentsRoutes);

// Performance (dashboard)
app.use("/api/performance/reviews",  reviewsRoutes);
app.use("/api/performance/goals",    goalsRoutes);
app.use("/api/performance/feedback", feedbackRoutes);

// Learning (dashboard)
app.use("/api/learning/courses",       coursesRoutes);
app.use("/api/learning/enrollments",   enrollmentsRoutes);
app.use("/api/learning/certifications", certificationsRoutes);

// Reports (dashboard)
app.use("/api/reports/diversity", diversityRoutes);
app.use("/api/reports/custom",    customReportsRoutes);

// Administration (dashboard)
app.use("/api/admin/roles",             rolesRoutes);
app.use("/api/admin/company",           companyRoutes);
app.use("/api/admin/leave-policies",    leavePoliciesRoutes);
app.use("/api/admin/integrations",      integrationsRoutes);
app.use("/api/offboarding",             offboardingRoutes);

// Public endpoints (no auth)
app.use("/public", publicRoutes);
app.use("/public", publicRecruitment);

// Tenants & misc
app.use("/api/tenants", tenantsRoutes);
app.use("/api/debug", require("./routes/debug"));
app.use("/api/me", require("./routes/me"));
app.use("/api/attendance/shifts", shiftsRoutes);


app.use("/api/attendance/leave", require("./routes/leaveRequests"));
// (Note: the next line mounts leaveRequests at /api/*; keep only if intentional)
app.use("/api/", require("./routes/leaveRequests"));
app.use("/api/attendance/timesheets", require("./routes/timeTracking"));


app.use("/api/shift-schedules", require("./routes/shiftSchedules"))
app.use("/api/attendance/time", require("./routes/timeTracking")); 
app.use("/api", require("./routes/salaryRequests"));
app.use("/api/attendance", attendanceRoutes);


const PORT = process.env.PORT || 5002;
app.listen(PORT, () =>
  console.log(`HR server running on http://localhost:${PORT}`)
);












