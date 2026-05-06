-- Estructura de referencia (las tablas se crean automáticamente con GORM AutoMigrate)
-- Base de datos: miweb_db

CREATE DATABASE IF NOT EXISTS miweb_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE miweb_db;

-- Usuarios (autenticación)
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at DATETIME(3),
  updated_at DATETIME(3),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY idx_users_email (email),
  KEY idx_users_deleted_at (deleted_at)
);

-- Configuración del estudio
CREATE TABLE IF NOT EXISTS firm_config (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  ruc VARCHAR(20) NOT NULL,
  address VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  logo_url VARCHAR(255),
  created_at DATETIME(3),
  updated_at DATETIME(3)
);

-- Empresas (clientes del estudio)
CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ruc VARCHAR(20) NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  internal_code VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'activo',
  trade_name VARCHAR(255),
  address VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  service_start_at DATETIME(3) NULL,
  created_at DATETIME(3),
  updated_at DATETIME(3),
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY idx_companies_code (internal_code),
  KEY idx_companies_ruc (ruc),
  KEY idx_companies_status (status),
  KEY idx_companies_deleted_at (deleted_at)
);

-- Contactos responsables por empresa
CREATE TABLE IF NOT EXISTS contacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  position VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  notes TEXT,
  priority VARCHAR(50),
  created_at DATETIME(3),
  updated_at DATETIME(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_contacts_company_id (company_id),
  KEY idx_contacts_deleted_at (deleted_at),
  CONSTRAINT fk_contacts_company FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- Documentos financieros (facturas, boletas, etc.)
CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  external_id VARCHAR(100),
  type VARCHAR(50) NOT NULL,
  number VARCHAR(50) NOT NULL,
  issue_date DATETIME(3),
  total_amount DECIMAL(15,2) NOT NULL,
  status VARCHAR(50) NOT NULL,
  source VARCHAR(50) NOT NULL,
  created_at DATETIME(3),
  updated_at DATETIME(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_documents_company_id (company_id),
  KEY idx_documents_external_id (external_id),
  KEY idx_documents_status (status),
  KEY idx_documents_deleted_at (deleted_at),
  CONSTRAINT fk_documents_company FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- Pagos registrados
CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  document_id BIGINT UNSIGNED NULL,
  date DATETIME(3),
  amount DECIMAL(15,2) NOT NULL,
  method VARCHAR(50),
  reference VARCHAR(100),
  attachment VARCHAR(255),
  notes TEXT,
  created_at DATETIME(3),
  updated_at DATETIME(3),
  deleted_at DATETIME(3) NULL,
  KEY idx_payments_company_id (company_id),
  KEY idx_payments_document_id (document_id),
  KEY idx_payments_deleted_at (deleted_at),
  CONSTRAINT fk_payments_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_payments_document FOREIGN KEY (document_id) REFERENCES documents(id)
);
