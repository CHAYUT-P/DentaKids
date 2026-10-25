-- Clear test data, keep the clinic's setup. Run ONCE, right before the clinic
-- announces the system — through deploy/clear-test-data.sh (which shows what
-- is there, asks first and takes a backup), not by hand.
--
-- Cleared: bookings and their history, holds, the website's demand log,
-- walk-ins, patients (families, children, charts, files, plans, recalls),
-- bills and payments, stock movements, expenses, lab orders, notifications,
-- reminders sent, error log, sign-in counters, audit log, time clock.
--
-- Kept: dentists (profiles, shifts, leave, what they treat, fees), treatments
-- and prices, opening hours, holidays, clinic info and settings, promotions,
-- staff accounts, the drug list, suppliers, stock items (counts set to 0),
-- and the LINE chat (real messages from families, not test data).
--
-- One TRUNCATE for all of them: Postgres refuses if a kept table still pointed
-- at a cleared one, so nothing outside this list can be emptied by accident.

BEGIN;

TRUNCATE
  appointment, visit_event, booking_attempt, slot_hold, message_log,
  waitlist_entry, visit_record,
  guardian, child, tooth_state, tooth_event, perio_exam, treatment_plan, plan_item,
  clinical_doc, patient_file, recall, patient_credit,
  invoice, invoice_item, payment, stock_move, expense, lab_order,
  staff_notification, rate_limit, error_event, audit_log, time_clock
RESTART IDENTITY;

-- the movements that made up the counts are gone; count the shelf again after
UPDATE stock_item SET qty = 0;

COMMIT;
