CREATE TABLE IF NOT EXISTS users (
  id              CHAR(36)     NOT NULL,
  email           VARCHAR(190) NOT NULL,
  name            VARCHAR(120) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('owner', 'organizer', 'staff') NOT NULL DEFAULT 'staff',
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'approved',
  staff_event_id  INT UNSIGNED NULL,
  pending_email   VARCHAR(190) NULL,
  pending_email_token CHAR(64) NULL,
  pending_email_expires_at DATETIME NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_staff_event (staff_event_id),
  KEY idx_users_pending_email_token (pending_email_token)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS events (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                   VARCHAR(120) NOT NULL,
  title                  VARCHAR(160) NOT NULL,
  body                   TEXT         NOT NULL,
  location               VARCHAR(160) NULL,
  starts_at              DATETIME     NOT NULL,
  ends_at                DATETIME     NULL,
  status                 ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  registration_closes_at DATETIME     NULL,
  created_by             CHAR(36)     NULL,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_starts_at (starts_at),
  CONSTRAINT fk_events_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64)     NOT NULL,
  user_id    CHAR(36)     NOT NULL,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS attendees (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id      INT UNSIGNED NOT NULL,
  code          CHAR(8)      NOT NULL,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  organization  VARCHAR(160) NOT NULL,
  phone         VARCHAR(40)  NOT NULL,
  checked_in_at DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_code (code),
  UNIQUE KEY uq_event_email (event_id, email),
  CONSTRAINT fk_attendees_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
