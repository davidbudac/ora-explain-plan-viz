// Minimal ambient declaration: the harness talks to oracledb through the
// structural DbConnection interface in evals/lib/db.ts, so the driver's own
// (untyped) module surface can stay `any`.
declare module 'oracledb';
