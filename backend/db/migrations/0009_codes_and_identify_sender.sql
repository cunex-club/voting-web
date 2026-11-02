-- "ระบุรหัส": a poll only for the student/staff ids its owner lists.
-- "ระบุคนส่ง": the owner sees each respondent's id next to their answers.
-- (New enum values can't be used in the transaction that adds them, so
-- nothing below refers to 'codes'.)
ALTER TYPE poll_audience ADD VALUE 'codes' AFTER 'restricted';

-- Staff ids (8 digits) from CUNEX /profile refId, matched against code lists.
ALTER TABLE users ADD COLUMN staff_id text CHECK (staff_id ~ '^\d{8}$');
CREATE INDEX users_staff_id_idx ON users (staff_id) WHERE staff_id IS NOT NULL;

-- Who may answer a codes poll: a student id (10 digits) or staff id (8 digits).
CREATE TABLE poll_audience_codes (
  poll_id  uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  code     text NOT NULL CHECK (code ~ '^(\d{8}|\d{10})$'),
  PRIMARY KEY (poll_id, code)
);
-- feed: "codes polls that list my id"
CREATE INDEX poll_audience_codes_code_idx ON poll_audience_codes (code);
CREATE TRIGGER poll_audience_codes_lock
  BEFORE INSERT OR UPDATE OR DELETE ON poll_audience_codes
  FOR EACH ROW EXECUTE FUNCTION trg_poll_elements_lock();

-- Locked with the rest of the draft once submitted, so voters who answered
-- anonymously can never be identified later. Public polls can't use it.
ALTER TABLE polls ADD COLUMN identify_sender boolean NOT NULL DEFAULT false;
ALTER TABLE polls ADD CONSTRAINT polls_identify_sender_not_public
  CHECK (NOT identify_sender OR audience <> 'public');

-- Ballots stay anonymous (voter_key only) unless the poll identifies senders:
-- then the voter's student/staff id is kept with the ballot, and voters are
-- told before they answer. NULL for every other poll.
ALTER TABLE ballots ADD COLUMN respondent_code text
  CHECK (respondent_code ~ '^(\d{8}|\d{10})$');
