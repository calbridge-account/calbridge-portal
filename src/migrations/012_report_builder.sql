CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.SAVED_REPORTS (
  report_id      VARCHAR(36)  NOT NULL PRIMARY KEY,
  client_id      VARCHAR(64)  NOT NULL,
  name           VARCHAR(255) NOT NULL DEFAULT 'Untitled Report',
  template_id    VARCHAR(36),
  global_filters VARIANT,
  tabs           VARIANT      NOT NULL,
  brand_config   VARIANT,
  created_at     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  updated_at     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS CALBRIDGE_PROD.APP.REPORT_TEMPLATES (
  template_id  VARCHAR(36)  NOT NULL PRIMARY KEY,
  client_id    VARCHAR(64),
  name         VARCHAR(255) NOT NULL,
  description  VARCHAR(500),
  tabs         VARIANT      NOT NULL,
  brand_config VARIANT,
  is_system    BOOLEAN      DEFAULT FALSE,
  created_at   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);
