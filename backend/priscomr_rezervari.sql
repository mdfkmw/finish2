-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Nov 07, 2025 at 11:07 AM
-- Server version: 10.6.23-MariaDB-cll-lve
-- PHP Version: 8.4.14

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `priscomr_rezervari`
--
CREATE DATABASE IF NOT EXISTS `priscomr_rezervari` DEFAULT CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci;
USE `priscomr_rezervari`;

DELIMITER $$
--
-- Procedures
--
DROP PROCEDURE IF EXISTS `sp_fill_trip_stations`$$
CREATE DEFINER=`priscomr`@`localhost` PROCEDURE `sp_fill_trip_stations` (IN `p_trip_id` INT)   proc: BEGIN
  DECLARE v_route_id INT DEFAULT NULL;
  DECLARE v_direction ENUM('tur','retur') DEFAULT 'tur';

  SELECT t.route_id, COALESCE(rs.direction, 'tur')
    INTO v_route_id, v_direction
  FROM trips t
  LEFT JOIN route_schedules rs ON rs.id = t.route_schedule_id
  WHERE t.id = p_trip_id
  LIMIT 1;

  IF v_route_id IS NULL THEN
    LEAVE proc;
  END IF;

  DELETE FROM trip_stations WHERE trip_id = p_trip_id;

  IF v_direction = 'retur' THEN
    INSERT INTO trip_stations (trip_id, station_id, sequence)
    SELECT p_trip_id, station_id, seq
    FROM (
      SELECT rs.station_id,
             ROW_NUMBER() OVER (ORDER BY rs.sequence DESC) AS seq
      FROM route_stations rs
      WHERE rs.route_id = v_route_id
    ) AS ordered;
  ELSE
    INSERT INTO trip_stations (trip_id, station_id, sequence)
    SELECT p_trip_id, rs.station_id, rs.sequence
    FROM route_stations rs
    WHERE rs.route_id = v_route_id
    ORDER BY rs.sequence;
  END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_free_seats`$$
CREATE DEFINER=`priscomr`@`localhost` PROCEDURE `sp_free_seats` (IN `p_trip_id` INT, IN `p_board_station_id` INT, IN `p_exit_station_id` INT)   BEGIN
  DECLARE v_bseq INT;
  DECLARE v_eseq INT;

  SELECT sequence INTO v_bseq
  FROM trip_stations
  WHERE trip_id = p_trip_id AND station_id = p_board_station_id
  LIMIT 1;

  SELECT sequence INTO v_eseq
  FROM trip_stations
  WHERE trip_id = p_trip_id AND station_id = p_exit_station_id
  LIMIT 1;

  IF v_bseq IS NULL OR v_eseq IS NULL OR v_bseq >= v_eseq THEN
    SELECT NULL AS id, NULL AS label, NULL AS status WHERE 1=0;
  ELSE
    WITH RECURSIVE segment_bounds AS (
      SELECT v_bseq AS seq
      UNION ALL
      SELECT seq + 1 FROM segment_bounds WHERE seq + 1 < v_eseq
    ),
    seat_segments AS (
      SELECT
        s.id AS seat_id,
        sb.seq,
        MAX(
          CASE
            WHEN ts_b.sequence IS NOT NULL
             AND ts_e.sequence IS NOT NULL
             AND ts_b.sequence <= sb.seq
             AND ts_e.sequence > sb.seq
            THEN 1 ELSE 0
          END
        ) AS covered
      FROM seats s
      JOIN trips t ON t.id = p_trip_id AND t.vehicle_id = s.vehicle_id
      JOIN segment_bounds sb ON TRUE
      LEFT JOIN reservations r
        ON r.trip_id = p_trip_id
        AND r.seat_id = s.id
        AND r.status = 'active'
      LEFT JOIN trip_stations ts_b
        ON ts_b.trip_id = r.trip_id
        AND ts_b.station_id = r.board_station_id
      LEFT JOIN trip_stations ts_e
        ON ts_e.trip_id = r.trip_id
        AND ts_e.station_id = r.exit_station_id
      WHERE s.seat_type IN ('normal','foldable','wheelchair','driver','guide')
      GROUP BY s.id, sb.seq
    )
    SELECT
      s.id,
      s.label,
      s.row,
      s.seat_col,
      s.seat_type,
      s.pair_id,
      CASE
        WHEN COALESCE(SUM(ss.covered), 0) = 0 THEN 'free'
        WHEN MIN(ss.covered) = 1 THEN 'full'
        ELSE 'partial'
      END AS status
    FROM seats s
    JOIN trips t ON t.id = p_trip_id AND t.vehicle_id = s.vehicle_id
    LEFT JOIN seat_segments ss ON ss.seat_id = s.id
    WHERE s.seat_type IN ('normal','foldable','wheelchair','driver','guide')
    GROUP BY s.id, s.label, s.row, s.seat_col, s.seat_type, s.pair_id
    ORDER BY s.row, s.seat_col;
  END IF;
END$$

DROP PROCEDURE IF EXISTS `sp_is_seat_free`$$
CREATE DEFINER=`priscomr`@`localhost` PROCEDURE `sp_is_seat_free` (IN `p_trip_id` INT, IN `p_seat_id` INT, IN `p_board_station_id` INT, IN `p_exit_station_id` INT)   BEGIN
  DECLARE v_bseq INT DEFAULT NULL;
  DECLARE v_eseq INT DEFAULT NULL;

  SELECT ts.sequence INTO v_bseq
  FROM trip_stations ts
  WHERE ts.trip_id = p_trip_id AND ts.station_id = p_board_station_id
  LIMIT 1;

  SELECT ts.sequence INTO v_eseq
  FROM trip_stations ts
  WHERE ts.trip_id = p_trip_id AND ts.station_id = p_exit_station_id
  LIMIT 1;

  IF v_bseq IS NULL OR v_eseq IS NULL OR v_bseq >= v_eseq THEN
    SELECT 0 AS is_free;
  ELSE
    SELECT CASE WHEN EXISTS (
      SELECT 1
      FROM reservations r
      JOIN trip_stations ts_b ON ts_b.trip_id = r.trip_id AND ts_b.station_id = r.board_station_id
      JOIN trip_stations ts_e ON ts_e.trip_id = r.trip_id AND ts_e.station_id = r.exit_station_id
      WHERE r.trip_id = p_trip_id
        AND r.seat_id = p_seat_id
        AND r.status = 'active'
        AND NOT (ts_e.sequence <= v_bseq OR ts_b.sequence >= v_eseq)
    ) THEN 0 ELSE 1 END AS is_free;
  END IF;
END$$

DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `agencies`
--

DROP TABLE IF EXISTS `agencies`;
CREATE TABLE `agencies` (
  `id` int(11) NOT NULL,
  `name` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `agent_chat_messages`
--

DROP TABLE IF EXISTS `agent_chat_messages`;
CREATE TABLE `agent_chat_messages` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `author_name` varchar(255) NOT NULL,
  `role` varchar(50) NOT NULL,
  `content` text DEFAULT NULL,
  `attachment_url` text DEFAULT NULL,
  `attachment_type` enum('image','link') DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `app_settings`
--

DROP TABLE IF EXISTS `app_settings`;
CREATE TABLE `app_settings` (
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
CREATE TABLE `audit_logs` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `actor_id` bigint(20) DEFAULT NULL,
  `entity` varchar(64) NOT NULL,
  `entity_id` bigint(20) DEFAULT NULL,
  `action` varchar(64) NOT NULL,
  `related_entity` varchar(64) DEFAULT 'reservation',
  `related_id` bigint(20) DEFAULT NULL,
  `correlation_id` char(36) DEFAULT NULL,
  `channel` enum('online','agent') DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `payment_method` enum('cash','card','online') DEFAULT NULL,
  `transaction_id` varchar(128) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `before_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`before_json`)),
  `after_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`after_json`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `audit_logs`
--

INSERT INTO `audit_logs` (`id`, `created_at`, `actor_id`, `entity`, `entity_id`, `action`, `related_entity`, `related_id`, `correlation_id`, `channel`, `amount`, `payment_method`, `transaction_id`, `note`, `before_json`, `after_json`) VALUES
(1, '2025-10-29 19:41:38', 1, 'reservation', 14, 'reservation.create', 'reservation', NULL, 'dc544604-65dc-4f78-8509-b46cd59897d6', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(2, '2025-10-29 19:42:31', 1, 'reservation', 14, 'reservation.cancel', 'reservation', NULL, '378ff90a-3d74-452e-bbcf-39a99ddbb497', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(3, '2025-10-29 19:42:31', 1, 'reservation', 15, 'reservation.create', 'reservation', 14, '378ff90a-3d74-452e-bbcf-39a99ddbb497', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(4, '2025-10-29 19:42:31', 1, 'reservation', 15, 'reservation.move', 'reservation', 14, '378ff90a-3d74-452e-bbcf-39a99ddbb497', 'agent', NULL, NULL, NULL, NULL, NULL, NULL),
(5, '2025-10-29 19:48:43', 1, 'reservation', 15, 'reservation.cancel', 'reservation', NULL, '32061b5f-e0fc-4849-9f0f-ae017440d74f', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(6, '2025-10-29 19:48:43', 1, 'reservation', 16, 'reservation.create', 'reservation', 15, '32061b5f-e0fc-4849-9f0f-ae017440d74f', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(7, '2025-10-29 19:48:43', 1, 'reservation', 16, 'reservation.move', 'reservation', 15, '32061b5f-e0fc-4849-9f0f-ae017440d74f', 'agent', NULL, NULL, NULL, NULL, NULL, NULL),
(8, '2025-11-07 09:54:16', 1, 'reservation', 17, 'reservation.create', 'reservation', NULL, 'd5e626cf-c1c3-467b-b270-388be0a6ac21', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(9, '2025-11-07 10:44:48', 1, 'reservation', 18, 'reservation.create', 'reservation', NULL, '9fb917cc-f0c6-4263-ad82-3de122840c39', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(10, '2025-11-07 10:44:55', 1, 'reservation', 19, 'reservation.create', 'reservation', NULL, '6d2a417c-08a4-44d8-85e0-72045fb13476', NULL, NULL, NULL, NULL, NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `blacklist`
--

DROP TABLE IF EXISTS `blacklist`;
CREATE TABLE `blacklist` (
  `id` int(11) NOT NULL,
  `person_id` int(11) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `added_by_employee_id` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `cash_handovers`
--

DROP TABLE IF EXISTS `cash_handovers`;
CREATE TABLE `cash_handovers` (
  `id` int(11) NOT NULL,
  `employee_id` int(11) DEFAULT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `discount_types`
--

DROP TABLE IF EXISTS `discount_types`;
CREATE TABLE `discount_types` (
  `id` int(11) NOT NULL,
  `code` varchar(50) NOT NULL,
  `label` text NOT NULL,
  `value_off` decimal(5,2) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `type` enum('percent','fixed') NOT NULL DEFAULT 'percent'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `employees`
--

DROP TABLE IF EXISTS `employees`;
CREATE TABLE `employees` (
  `id` int(11) NOT NULL,
  `name` text NOT NULL,
  `username` varchar(191) DEFAULT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `password_hash` text DEFAULT NULL,
  `role` enum('driver','agent','operator_admin','admin') NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `operator_id` int(11) NOT NULL DEFAULT 1,
  `agency_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `employees`
--

INSERT INTO `employees` (`id`, `name`, `username`, `phone`, `email`, `password_hash`, `role`, `active`, `created_at`, `operator_id`, `agency_id`) VALUES
(1, 'admin', 'admin', '0743171315', NULL, '$2a$12$eZZLP5AOlQJuOl/5ctwDeOp0avF8iY5zfIadvp1v7P9U7oTZDoPfe', 'admin', 1, '2025-08-04 13:46:37', 2, 1),
(2, 'lavinia', 'lavinia', '0742852790', NULL, '$2a$12$qw5jN.PIZnNt05E13z5kQ.jrEbNUyxe6nl.vywLHPC3ivk6LYuLr.', 'agent', 1, '2025-10-24 15:56:33', 2, 1);

-- --------------------------------------------------------

--
-- Table structure for table `idempotency_keys`
--

DROP TABLE IF EXISTS `idempotency_keys`;
CREATE TABLE `idempotency_keys` (
  `id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `idem_key` varchar(128) NOT NULL,
  `reservation_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `idempotency_keys`
--

INSERT INTO `idempotency_keys` (`id`, `user_id`, `idem_key`, `reservation_id`, `created_at`) VALUES
(1, 1, '4290b244-b9d3-4231-9219-4e0dbe4f6b3e', 18, '2025-11-07 10:44:48'),
(2, 1, '9d7de625-1a94-4d4e-b054-316aefc7e3a2', 19, '2025-11-07 10:44:55');

-- --------------------------------------------------------

--
-- Table structure for table `invitations`
--

DROP TABLE IF EXISTS `invitations`;
CREATE TABLE `invitations` (
  `id` int(11) NOT NULL,
  `token` varchar(255) NOT NULL,
  `role` enum('driver','agent','operator_admin','admin') NOT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `created_by` int(11) DEFAULT NULL,
  `used_at` datetime DEFAULT NULL,
  `used_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `no_shows`
--

DROP TABLE IF EXISTS `no_shows`;
CREATE TABLE `no_shows` (
  `id` int(11) NOT NULL,
  `person_id` int(11) DEFAULT NULL,
  `trip_id` int(11) DEFAULT NULL,
  `seat_id` int(11) DEFAULT NULL,
  `reservation_id` int(11) DEFAULT NULL,
  `board_station_id` int(11) DEFAULT NULL,
  `exit_station_id` int(11) DEFAULT NULL,
  `added_by_employee_id` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `operators`
--

DROP TABLE IF EXISTS `operators`;
CREATE TABLE `operators` (
  `id` int(11) NOT NULL,
  `name` text NOT NULL,
  `pos_endpoint` text NOT NULL,
  `theme_color` varchar(7) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `operators`
--

INSERT INTO `operators` (`id`, `name`, `pos_endpoint`, `theme_color`) VALUES
(1, 'Pris-Com', 'https://pos.priscom.ro/pay', '#FF0000'),
(2, 'Auto-Dimas', 'https://pos.autodimas.ro/pay', '#0000FF');

-- --------------------------------------------------------

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
CREATE TABLE `payments` (
  `id` int(11) NOT NULL,
  `reservation_id` int(11) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `status` enum('pending','paid','failed') NOT NULL DEFAULT 'pending',
  `payment_method` varchar(20) DEFAULT NULL,
  `transaction_id` text DEFAULT NULL,
  `timestamp` datetime DEFAULT current_timestamp(),
  `deposited_at` date DEFAULT NULL,
  `deposited_by` int(11) DEFAULT NULL,
  `collected_by` int(11) DEFAULT NULL,
  `cash_handover_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `people`
--

DROP TABLE IF EXISTS `people`;
CREATE TABLE `people` (
  `id` int(11) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `owner_status` enum('active','pending','hidden') NOT NULL DEFAULT 'active',
  `prev_owner_id` int(11) DEFAULT NULL,
  `replaced_by_id` int(11) DEFAULT NULL,
  `owner_changed_by` int(11) DEFAULT NULL,
  `owner_changed_at` datetime DEFAULT NULL,
  `blacklist` tinyint(1) NOT NULL DEFAULT 0,
  `whitelist` tinyint(1) NOT NULL DEFAULT 0,
  `notes` text DEFAULT NULL,
  `notes_by` int(11) DEFAULT NULL,
  `notes_at` datetime DEFAULT NULL,
  `is_active` tinyint(1) GENERATED ALWAYS AS (case when `owner_status` = 'active' then 1 else NULL end) STORED,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `people`
--

INSERT INTO `people` (`id`, `name`, `phone`, `owner_status`, `prev_owner_id`, `replaced_by_id`, `owner_changed_by`, `owner_changed_at`, `blacklist`, `whitelist`, `notes`, `notes_by`, `notes_at`, `updated_at`) VALUES
(7, 'test', NULL, 'active', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, '2025-11-07 09:54:16'),
(8, 'test3', NULL, 'active', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, '2025-11-07 10:44:55');

-- --------------------------------------------------------

--
-- Table structure for table `price_lists`
--

DROP TABLE IF EXISTS `price_lists`;
CREATE TABLE `price_lists` (
  `id` int(11) NOT NULL,
  `name` text NOT NULL,
  `version` int(11) NOT NULL DEFAULT 1,
  `effective_from` date NOT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `route_id` int(11) NOT NULL,
  `category_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `price_lists`
--

INSERT INTO `price_lists` (`id`, `name`, `version`, `effective_from`, `created_by`, `created_at`, `route_id`, `category_id`) VALUES
(1, '1-1-2025-10-24', 1, '2025-10-24', 1, '2025-10-24 16:14:02', 1, 1),
(2, '1-2-2025-10-31', 1, '2025-10-31', 1, '2025-10-31 22:01:12', 1, 2),
(3, '1-1-2025-11-07', 1, '2025-11-07', 1, '2025-11-07 09:03:46', 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `price_list_items`
--

DROP TABLE IF EXISTS `price_list_items`;
CREATE TABLE `price_list_items` (
  `id` int(11) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `currency` varchar(5) NOT NULL DEFAULT 'RON',
  `price_return` decimal(10,2) DEFAULT NULL,
  `price_list_id` int(11) DEFAULT NULL,
  `from_station_id` int(11) NOT NULL,
  `to_station_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `price_list_items`
--

INSERT INTO `price_list_items` (`id`, `price`, `currency`, `price_return`, `price_list_id`, `from_station_id`, `to_station_id`) VALUES
(2, 1.00, 'RON', 1.00, 1, 1, 2),
(3, 45.00, 'RON', NULL, 2, 1, 2),
(4, 45.00, 'RON', NULL, 2, 2, 1),
(5, 0.10, 'RON', NULL, 3, 1, 2),
(6, 0.10, 'RON', NULL, 3, 2, 1);

-- --------------------------------------------------------

--
-- Table structure for table `pricing_categories`
--

DROP TABLE IF EXISTS `pricing_categories`;
CREATE TABLE `pricing_categories` (
  `id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `pricing_categories`
--

INSERT INTO `pricing_categories` (`id`, `name`, `description`, `active`) VALUES
(1, 'Normal', 'Preț standard pentru bilete individuale', 1),
(2, 'Online', 'Preț standard pentru bilete online', 1),
(3, 'Student', 'Preț standard pentru studenți', 1);

-- --------------------------------------------------------

--
-- Table structure for table `promo_codes`
--

DROP TABLE IF EXISTS `promo_codes`;
CREATE TABLE `promo_codes` (
  `id` int(11) NOT NULL,
  `code` varchar(50) NOT NULL,
  `label` text NOT NULL,
  `type` enum('percent','fixed') NOT NULL,
  `value_off` decimal(7,2) NOT NULL,
  `valid_from` datetime DEFAULT NULL,
  `valid_to` datetime DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `channels` set('online','agent') NOT NULL DEFAULT 'online',
  `min_price` decimal(10,2) DEFAULT NULL,
  `max_discount` decimal(10,2) DEFAULT NULL,
  `max_total_uses` int(11) DEFAULT NULL,
  `max_uses_per_person` int(11) DEFAULT NULL,
  `combinable` tinyint(1) NOT NULL DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `promo_code_hours`
--

DROP TABLE IF EXISTS `promo_code_hours`;
CREATE TABLE `promo_code_hours` (
  `promo_code_id` int(11) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `promo_code_routes`
--

DROP TABLE IF EXISTS `promo_code_routes`;
CREATE TABLE `promo_code_routes` (
  `promo_code_id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `promo_code_schedules`
--

DROP TABLE IF EXISTS `promo_code_schedules`;
CREATE TABLE `promo_code_schedules` (
  `promo_code_id` int(11) NOT NULL,
  `route_schedule_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `promo_code_usages`
--

DROP TABLE IF EXISTS `promo_code_usages`;
CREATE TABLE `promo_code_usages` (
  `id` int(11) NOT NULL,
  `promo_code_id` int(11) NOT NULL,
  `reservation_id` int(11) DEFAULT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `used_at` datetime NOT NULL DEFAULT current_timestamp(),
  `discount_amount` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `promo_code_weekdays`
--

DROP TABLE IF EXISTS `promo_code_weekdays`;
CREATE TABLE `promo_code_weekdays` (
  `promo_code_id` int(11) NOT NULL,
  `weekday` tinyint(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reservations`
--

DROP TABLE IF EXISTS `reservations`;
CREATE TABLE `reservations` (
  `id` int(11) NOT NULL,
  `trip_id` int(11) DEFAULT NULL,
  `seat_id` int(11) DEFAULT NULL,
  `person_id` int(11) DEFAULT NULL,
  `reservation_time` timestamp NULL DEFAULT current_timestamp(),
  `status` enum('active','cancelled') NOT NULL DEFAULT 'active',
  `observations` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `board_station_id` int(11) NOT NULL,
  `exit_station_id` int(11) NOT NULL,
  `version` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `reservations`
--

INSERT INTO `reservations` (`id`, `trip_id`, `seat_id`, `person_id`, `reservation_time`, `status`, `observations`, `created_by`, `board_station_id`, `exit_station_id`, `version`) VALUES
(17, 730, 25, 7, '2025-11-07 07:54:16', 'active', NULL, 1, 1, 2, 0),
(18, 730, 26, 7, '2025-11-07 08:44:48', 'active', NULL, 1, 1, 2, 0),
(19, 730, 27, 8, '2025-11-07 08:44:55', 'active', NULL, 1, 1, 2, 0);

-- --------------------------------------------------------

--
-- Table structure for table `reservations_backup`
--

DROP TABLE IF EXISTS `reservations_backup`;
CREATE TABLE `reservations_backup` (
  `id` int(11) NOT NULL,
  `reservation_id` int(11) DEFAULT NULL,
  `trip_id` int(11) DEFAULT NULL,
  `seat_id` int(11) DEFAULT NULL,
  `label` text DEFAULT NULL,
  `person_id` int(11) DEFAULT NULL,
  `backup_time` datetime DEFAULT current_timestamp(),
  `old_vehicle_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reservation_discounts`
--

DROP TABLE IF EXISTS `reservation_discounts`;
CREATE TABLE `reservation_discounts` (
  `id` int(11) NOT NULL,
  `reservation_id` int(11) NOT NULL,
  `discount_type_id` int(11) DEFAULT NULL,
  `promo_code_id` int(11) DEFAULT NULL,
  `discount_amount` decimal(10,2) NOT NULL,
  `applied_at` datetime NOT NULL DEFAULT current_timestamp(),
  `discount_snapshot` decimal(5,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reservation_events`
--

DROP TABLE IF EXISTS `reservation_events`;
CREATE TABLE `reservation_events` (
  `id` int(11) NOT NULL,
  `reservation_id` int(11) NOT NULL,
  `action` enum('create','update','move','cancel','uncancel','delete','pay','refund') NOT NULL,
  `actor_id` int(11) DEFAULT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reservation_intents`
--

DROP TABLE IF EXISTS `reservation_intents`;
CREATE TABLE `reservation_intents` (
  `id` int(11) NOT NULL,
  `trip_id` int(11) NOT NULL,
  `seat_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reservation_pricing`
--

DROP TABLE IF EXISTS `reservation_pricing`;
CREATE TABLE `reservation_pricing` (
  `reservation_id` int(11) NOT NULL,
  `price_value` decimal(10,2) NOT NULL,
  `price_list_id` int(11) NOT NULL,
  `pricing_category_id` int(11) NOT NULL,
  `booking_channel` enum('online','agent') NOT NULL DEFAULT 'agent',
  `employee_id` int(11) NOT NULL DEFAULT 12,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `reservation_pricing`
--

INSERT INTO `reservation_pricing` (`reservation_id`, `price_value`, `price_list_id`, `pricing_category_id`, `booking_channel`, `employee_id`, `created_at`, `updated_at`) VALUES
(17, 0.10, 3, 1, 'agent', 1, '2025-11-07 09:54:16', '2025-11-07 09:54:16'),
(18, 0.10, 3, 1, 'agent', 1, '2025-11-07 10:44:48', '2025-11-07 10:44:48'),
(19, 0.10, 3, 1, 'agent', 1, '2025-11-07 10:44:55', '2025-11-07 10:44:55');

-- --------------------------------------------------------

--
-- Table structure for table `routes`
--

DROP TABLE IF EXISTS `routes`;
CREATE TABLE `routes` (
  `id` int(11) NOT NULL,
  `name` text NOT NULL,
  `order_index` int(11) DEFAULT NULL,
  `visible_in_reservations` tinyint(1) DEFAULT 1,
  `visible_for_drivers` tinyint(1) DEFAULT 1,
  `visible_online` tinyint(4) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `routes`
--

INSERT INTO `routes` (`id`, `name`, `order_index`, `visible_in_reservations`, `visible_for_drivers`, `visible_online`) VALUES
(1, 'Botoșani - Iași', NULL, 1, 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `route_schedules`
--

DROP TABLE IF EXISTS `route_schedules`;
CREATE TABLE `route_schedules` (
  `id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `departure` time NOT NULL,
  `operator_id` int(11) NOT NULL,
  `direction` enum('tur','retur') NOT NULL DEFAULT 'tur'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `route_schedules`
--

INSERT INTO `route_schedules` (`id`, `route_id`, `departure`, `operator_id`, `direction`) VALUES
(1, 1, '06:00:00', 1, 'tur'),
(2, 1, '07:00:00', 2, 'retur'),
(3, 1, '08:00:00', 2, 'tur'),
(4, 1, '09:00:00', 2, 'retur'),
(5, 1, '10:00:00', 2, 'tur'),
(6, 1, '11:00:00', 2, 'tur');

-- --------------------------------------------------------

--
-- Table structure for table `route_schedule_discounts`
--

DROP TABLE IF EXISTS `route_schedule_discounts`;
CREATE TABLE `route_schedule_discounts` (
  `discount_type_id` int(11) NOT NULL,
  `route_schedule_id` int(11) NOT NULL,
  `visible_agents` tinyint(1) NOT NULL DEFAULT 1,
  `visible_online` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `route_schedule_pricing_categories`
--

DROP TABLE IF EXISTS `route_schedule_pricing_categories`;
CREATE TABLE `route_schedule_pricing_categories` (
  `route_schedule_id` int(11) NOT NULL,
  `pricing_category_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `route_schedule_pricing_categories`
--

INSERT INTO `route_schedule_pricing_categories` (`route_schedule_id`, `pricing_category_id`) VALUES
(1, 1),
(2, 1),
(3, 1),
(4, 1),
(5, 1),
(6, 1);

-- --------------------------------------------------------

--
-- Table structure for table `route_stations`
--

DROP TABLE IF EXISTS `route_stations`;
CREATE TABLE `route_stations` (
  `id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `station_id` int(11) NOT NULL,
  `sequence` int(11) NOT NULL,
  `distance_from_previous_km` decimal(6,2) DEFAULT NULL,
  `travel_time_from_previous_minutes` int(11) DEFAULT NULL,
  `dwell_time_minutes` int(11) DEFAULT 0,
  `geofence_type` enum('circle','polygon') NOT NULL DEFAULT 'circle',
  `geofence_radius_m` decimal(10,2) DEFAULT NULL,
  `geofence_polygon` geometry DEFAULT NULL,
  `public_note_tur` varchar(255) DEFAULT NULL,
  `public_note_retur` varchar(255) DEFAULT NULL,
  `public_latitude_tur` decimal(10,7) DEFAULT NULL,
  `public_longitude_tur` decimal(10,7) DEFAULT NULL,
  `public_latitude_retur` decimal(10,7) DEFAULT NULL,
  `public_longitude_retur` decimal(10,7) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `route_stations`
--

INSERT INTO `route_stations` (`id`, `route_id`, `station_id`, `sequence`, `distance_from_previous_km`, `travel_time_from_previous_minutes`, `dwell_time_minutes`, `geofence_type`, `geofence_radius_m`, `geofence_polygon`, `public_note_tur`, `public_note_retur`, `public_latitude_tur`, `public_longitude_tur`, `public_latitude_retur`, `public_longitude_retur`, `created_at`, `updated_at`) VALUES
(8, 1, 1, 1, 70.00, 60, 0, 'circle', 200.00, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-10-31 22:06:59', '2025-10-31 22:06:59'),
(9, 1, 3, 2, NULL, 50, 0, 'circle', 200.00, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-10-31 22:06:59', '2025-10-31 22:06:59'),
(10, 1, 2, 3, NULL, NULL, 0, 'circle', 200.00, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-10-31 22:06:59', '2025-10-31 22:06:59');

-- --------------------------------------------------------

--
-- Table structure for table `schedule_exceptions`
--

DROP TABLE IF EXISTS `schedule_exceptions`;
CREATE TABLE `schedule_exceptions` (
  `id` int(11) NOT NULL,
  `schedule_id` int(11) NOT NULL,
  `exception_date` date DEFAULT NULL,
  `weekday` tinyint(3) UNSIGNED DEFAULT NULL,
  `disable_run` tinyint(1) NOT NULL DEFAULT 0,
  `disable_online` tinyint(1) NOT NULL DEFAULT 0,
  `created_by_employee_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `seats`
--

DROP TABLE IF EXISTS `seats`;
CREATE TABLE `seats` (
  `id` int(11) NOT NULL,
  `vehicle_id` int(11) DEFAULT NULL,
  `seat_number` int(11) DEFAULT NULL,
  `position` varchar(20) DEFAULT NULL,
  `row` int(11) NOT NULL,
  `seat_col` int(11) NOT NULL,
  `is_available` tinyint(1) NOT NULL DEFAULT 1,
  `label` text DEFAULT NULL,
  `seat_type` enum('normal','driver','guide','foldable','wheelchair') NOT NULL DEFAULT 'normal',
  `pair_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `seats`
--

INSERT INTO `seats` (`id`, `vehicle_id`, `seat_number`, `position`, `row`, `seat_col`, `is_available`, `label`, `seat_type`, `pair_id`) VALUES
(1, 1, NULL, NULL, 0, 1, 1, 'Șofer', 'driver', NULL),
(2, 1, NULL, NULL, 0, 3, 1, 'Ghid', 'guide', NULL),
(3, 1, NULL, NULL, 1, 1, 1, '1', 'normal', NULL),
(4, 1, NULL, NULL, 1, 2, 1, '2', 'normal', NULL),
(5, 1, NULL, NULL, 1, 4, 1, '3', 'normal', NULL),
(6, 1, NULL, NULL, 2, 1, 1, '4', 'normal', NULL),
(7, 1, NULL, NULL, 2, 2, 1, '5', 'normal', NULL),
(8, 1, NULL, NULL, 2, 4, 1, '6', 'normal', NULL),
(9, 1, NULL, NULL, 3, 1, 1, '7', 'normal', NULL),
(10, 1, NULL, NULL, 3, 2, 1, '8', 'normal', NULL),
(11, 1, NULL, NULL, 3, 4, 1, '9', 'normal', NULL),
(12, 1, NULL, NULL, 4, 1, 1, '10', 'normal', NULL),
(13, 1, NULL, NULL, 4, 2, 1, '11', 'normal', NULL),
(14, 1, NULL, NULL, 4, 4, 1, '12', 'normal', NULL),
(15, 1, NULL, NULL, 5, 1, 1, '13', 'normal', NULL),
(16, 1, NULL, NULL, 5, 2, 1, '14', 'normal', NULL),
(17, 1, NULL, NULL, 5, 4, 1, '15', 'normal', NULL),
(18, 1, NULL, NULL, 6, 1, 1, '16', 'normal', NULL),
(19, 1, NULL, NULL, 6, 2, 1, '17', 'normal', NULL),
(20, 1, NULL, NULL, 6, 3, 1, '18', 'normal', NULL),
(21, 1, NULL, NULL, 6, 4, 1, '19', 'normal', NULL),
(22, 1, NULL, NULL, 0, 4, 1, '20', 'normal', NULL),
(23, 2, NULL, NULL, 0, 1, 1, 'Șofer', 'driver', NULL),
(24, 2, NULL, NULL, 0, 3, 1, 'Ghid', 'guide', NULL),
(25, 2, NULL, NULL, 1, 1, 1, '1', 'normal', NULL),
(26, 2, NULL, NULL, 1, 2, 1, '2', 'normal', NULL),
(27, 2, NULL, NULL, 1, 4, 1, '3', 'normal', NULL),
(28, 2, NULL, NULL, 2, 1, 1, '4', 'normal', NULL),
(29, 2, NULL, NULL, 2, 2, 1, '5', 'normal', NULL),
(30, 2, NULL, NULL, 2, 4, 1, '6', 'normal', NULL),
(31, 2, NULL, NULL, 3, 1, 1, '7', 'normal', NULL),
(32, 2, NULL, NULL, 3, 2, 1, '8', 'normal', NULL),
(33, 2, NULL, NULL, 3, 4, 1, '9', 'normal', NULL),
(34, 2, NULL, NULL, 4, 1, 1, '10', 'normal', NULL),
(35, 2, NULL, NULL, 4, 2, 1, '11', 'normal', NULL),
(36, 2, NULL, NULL, 4, 4, 1, '12', 'normal', NULL),
(37, 2, NULL, NULL, 5, 1, 1, '13', 'normal', NULL),
(38, 2, NULL, NULL, 5, 2, 1, '14', 'normal', NULL),
(39, 2, NULL, NULL, 5, 4, 1, '15', 'normal', NULL),
(40, 2, NULL, NULL, 6, 1, 1, '16', 'normal', NULL),
(41, 2, NULL, NULL, 6, 2, 1, '17', 'normal', NULL),
(42, 2, NULL, NULL, 6, 3, 1, '18', 'normal', NULL),
(43, 2, NULL, NULL, 6, 4, 1, '19', 'normal', NULL),
(44, 2, NULL, NULL, 0, 4, 1, '20', 'normal', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `seat_locks`
--

DROP TABLE IF EXISTS `seat_locks`;
CREATE TABLE `seat_locks` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `trip_id` bigint(20) UNSIGNED NOT NULL,
  `seat_id` bigint(20) UNSIGNED NOT NULL,
  `board_station_id` bigint(20) UNSIGNED NOT NULL,
  `exit_station_id` bigint(20) UNSIGNED NOT NULL,
  `operator_id` bigint(20) UNSIGNED DEFAULT NULL,
  `employee_id` bigint(20) UNSIGNED DEFAULT NULL,
  `hold_token` varchar(64) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sessions`
--

DROP TABLE IF EXISTS `sessions`;
CREATE TABLE `sessions` (
  `id` int(11) NOT NULL,
  `employee_id` int(11) NOT NULL,
  `token_hash` varchar(255) NOT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `ip` varchar(64) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `rotated_from` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `sessions`
--

INSERT INTO `sessions` (`id`, `employee_id`, `token_hash`, `user_agent`, `ip`, `created_at`, `expires_at`, `revoked_at`, `rotated_from`) VALUES
(15, 1, '007ffe6c6667e234d437e29d21aab73b7607e6b34df1b528d0adf8ff81a24b9c', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', '82.77.242.74', '2025-11-07 09:54:10', '2025-12-07 09:54:10', NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `public_users`
--

DROP TABLE IF EXISTS `public_users`;
CREATE TABLE `public_users` (
  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `email_normalized` varchar(255) NOT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `phone_normalized` varchar(32) DEFAULT NULL,
  `email_verified_at` datetime DEFAULT NULL,
  `phone_verified_at` datetime DEFAULT NULL,
  `google_sub` varchar(191) DEFAULT NULL,
  `apple_sub` varchar(191) DEFAULT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_public_users_email_norm` (`email_normalized`),
  UNIQUE KEY `uniq_public_users_google` (`google_sub`),
  UNIQUE KEY `uniq_public_users_apple` (`apple_sub`),
  KEY `idx_public_users_phone_norm` (`phone_normalized`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `public_user_sessions`
--

DROP TABLE IF EXISTS `public_user_sessions`;
CREATE TABLE `public_user_sessions` (
  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `token_hash` char(64) NOT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `ip_address` varchar(64) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `rotated_from` char(64) DEFAULT NULL,
  `persistent` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_public_sessions_hash` (`token_hash`),
  KEY `idx_public_sessions_user` (`user_id`),
  KEY `idx_public_sessions_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `public_user_phone_links`
--

DROP TABLE IF EXISTS `public_user_phone_links`;
CREATE TABLE `public_user_phone_links` (
  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `person_id` int(11) DEFAULT NULL,
  `phone` varchar(32) NOT NULL,
  `normalized_phone` varchar(32) NOT NULL,
  `status` enum('pending','verified','expired','failed','cancelled') NOT NULL DEFAULT 'pending',
  `channel` enum('sms','whatsapp') NOT NULL DEFAULT 'sms',
  `verification_code_hash` char(64) NOT NULL,
  `request_token` char(36) NOT NULL,
  `attempt_count` int(11) NOT NULL DEFAULT 0,
  `expires_at` datetime NOT NULL,
  `verified_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_public_phone_request` (`request_token`),
  KEY `idx_public_phone_user` (`user_id`),
  KEY `idx_public_phone_person` (`person_id`),
  KEY `idx_public_phone_status` (`status`),
  KEY `idx_public_phone_normalized` (`normalized_phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `stations`
--

DROP TABLE IF EXISTS `stations`;
CREATE TABLE `stations` (
  `id` int(11) NOT NULL,
  `name` text NOT NULL,
  `locality` text DEFAULT NULL,
  `county` text DEFAULT NULL,
  `latitude` decimal(11,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `stations`
--

INSERT INTO `stations` (`id`, `name`, `locality`, `county`, `latitude`, `longitude`, `created_at`, `updated_at`) VALUES
(1, 'Botoșani', 'Botoșani', 'Botoșani', 47.74203016, 26.66423654, '2025-10-24 16:11:41', '2025-11-03 09:07:48'),
(2, 'Iași', 'Iași', 'Iași', -0.00102997, -0.03227234, '2025-10-24 16:11:56', '2025-10-24 16:11:56'),
(3, 'Hârlău', 'Hârlău', 'Iasi', 0.00000000, 0.00000000, '2025-10-31 22:06:26', '2025-11-03 09:08:27');

-- --------------------------------------------------------

--
-- Table structure for table `traveler_defaults`
--

DROP TABLE IF EXISTS `traveler_defaults`;
CREATE TABLE `traveler_defaults` (
  `id` int(11) NOT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `route_id` int(11) DEFAULT NULL,
  `use_count` int(11) DEFAULT 0,
  `last_used_at` datetime DEFAULT NULL,
  `board_station_id` int(11) DEFAULT NULL,
  `exit_station_id` int(11) DEFAULT NULL,
  `direction` enum('tur','retur') NOT NULL DEFAULT 'tur'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `trips`
--

DROP TABLE IF EXISTS `trips`;
CREATE TABLE `trips` (
  `id` int(11) NOT NULL,
  `route_id` int(11) DEFAULT NULL,
  `vehicle_id` int(11) DEFAULT NULL,
  `date` date DEFAULT NULL,
  `time` time DEFAULT NULL,
  `disabled` tinyint(1) NOT NULL DEFAULT 0,
  `route_schedule_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `trips`
--

INSERT INTO `trips` (`id`, `route_id`, `vehicle_id`, `date`, `time`, `disabled`, `route_schedule_id`) VALUES
(730, 1, 2, '2025-11-07', '06:00:00', 0, 1),
(731, 1, 1, '2025-11-07', '08:00:00', 0, 3);

--
-- Triggers `trips`
--
DROP TRIGGER IF EXISTS `trg_trips_ai_snapshot`;
DELIMITER $$
CREATE TRIGGER `trg_trips_ai_snapshot` AFTER INSERT ON `trips` FOR EACH ROW BEGIN
  CALL sp_fill_trip_stations(NEW.id);
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `trip_stations`
--

DROP TABLE IF EXISTS `trip_stations`;
CREATE TABLE `trip_stations` (
  `trip_id` int(11) NOT NULL,
  `station_id` int(11) NOT NULL,
  `sequence` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `trip_stations`
--

INSERT INTO `trip_stations` (`trip_id`, `station_id`, `sequence`) VALUES
(730, 1, 1),
(730, 3, 2),
(730, 2, 3),
(731, 1, 1),
(731, 3, 2),
(731, 2, 3);

-- --------------------------------------------------------

--
-- Table structure for table `trip_vehicles`
--

DROP TABLE IF EXISTS `trip_vehicles`;
CREATE TABLE `trip_vehicles` (
  `id` int(11) NOT NULL,
  `trip_id` int(11) DEFAULT NULL,
  `vehicle_id` int(11) DEFAULT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `trip_vehicles`
--

INSERT INTO `trip_vehicles` (`id`, `trip_id`, `vehicle_id`, `is_primary`) VALUES
(730, 730, 2, 1),
(731, 731, 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `trip_vehicle_employees`
--

DROP TABLE IF EXISTS `trip_vehicle_employees`;
CREATE TABLE `trip_vehicle_employees` (
  `id` int(11) NOT NULL,
  `trip_vehicle_id` int(11) DEFAULT NULL,
  `employee_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_preferences`
--

DROP TABLE IF EXISTS `user_preferences`;
CREATE TABLE `user_preferences` (
  `user_id` bigint(20) NOT NULL,
  `prefs_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT json_object() CHECK (json_valid(`prefs_json`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_route_order`
--

DROP TABLE IF EXISTS `user_route_order`;
CREATE TABLE `user_route_order` (
  `id` bigint(20) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `route_id` bigint(20) NOT NULL,
  `position_idx` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `vehicles`
--

DROP TABLE IF EXISTS `vehicles`;
CREATE TABLE `vehicles` (
  `id` int(11) NOT NULL,
  `name` text NOT NULL,
  `seat_count` int(11) DEFAULT NULL,
  `type` varchar(20) DEFAULT NULL,
  `plate_number` varchar(20) DEFAULT NULL,
  `operator_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `vehicles`
--

INSERT INTO `vehicles` (`id`, `name`, `seat_count`, `type`, `plate_number`, `operator_id`) VALUES
(1, 'Microbuz', 20, 'microbuz', 'BT22DMS', 2),
(2, 'Microbuz', 20, 'microbuz', 'BT01PRI', 1);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `agencies`
--
ALTER TABLE `agencies`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `audit_logs`
--
ALTER TABLE `audit_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audit_created_at` (`created_at`),
  ADD KEY `idx_audit_action` (`action`),
  ADD KEY `idx_audit_entity_id` (`entity`,`entity_id`),
  ADD KEY `idx_audit_related_id` (`related_entity`,`related_id`);

--
-- Indexes for table `employees`
--
ALTER TABLE `employees`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_employees_role` (`role`),
  ADD UNIQUE KEY `uniq_employees_username` (`username`),
  ADD UNIQUE KEY `uniq_employees_email` (`email`);

--
-- Indexes for table `idempotency_keys`
--
ALTER TABLE `idempotency_keys`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_user_key` (`user_id`,`idem_key`);

--
-- Indexes for table `invitations`
--
ALTER TABLE `invitations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `token` (`token`),
  ADD KEY `fk_inv_operator` (`operator_id`);

--
-- Indexes for table `no_shows`
--
ALTER TABLE `no_shows`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `operators`
--
ALTER TABLE `operators`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `payments`
--
ALTER TABLE `payments`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `people`
--
ALTER TABLE `people`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `ux_people_phone_active` (`phone`,`is_active`),
  ADD KEY `ix_people_owner_changed_by` (`owner_changed_by`),
  ADD KEY `ix_people_owner_changed_at` (`owner_changed_at`);

--
-- Indexes for table `price_lists`
--
ALTER TABLE `price_lists`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `price_list_items`
--
ALTER TABLE `price_list_items`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_price_list_items_unique` (`price_list_id`,`from_station_id`,`to_station_id`);

--
-- Indexes for table `pricing_categories`
--
ALTER TABLE `pricing_categories`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `promo_codes`
--
ALTER TABLE `promo_codes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`);

--
-- Indexes for table `promo_code_hours`
--
ALTER TABLE `promo_code_hours`
  ADD PRIMARY KEY (`promo_code_id`,`start_time`,`end_time`);

--
-- Indexes for table `promo_code_routes`
--
ALTER TABLE `promo_code_routes`
  ADD PRIMARY KEY (`promo_code_id`,`route_id`),
  ADD KEY `route_id` (`route_id`);

--
-- Indexes for table `promo_code_schedules`
--
ALTER TABLE `promo_code_schedules`
  ADD PRIMARY KEY (`promo_code_id`,`route_schedule_id`),
  ADD KEY `route_schedule_id` (`route_schedule_id`);

--
-- Indexes for table `promo_code_usages`
--
ALTER TABLE `promo_code_usages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `promo_code_id` (`promo_code_id`);

--
-- Indexes for table `promo_code_weekdays`
--
ALTER TABLE `promo_code_weekdays`
  ADD PRIMARY KEY (`promo_code_id`,`weekday`);

--
-- Indexes for table `reservations`
--
ALTER TABLE `reservations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ix_res_trip_seat_status` (`trip_id`,`seat_id`,`status`),
  ADD KEY `ix_res_person_time` (`person_id`,`reservation_time`);

--
-- Indexes for table `reservations_backup`
--
ALTER TABLE `reservations_backup`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `reservation_discounts`
--
ALTER TABLE `reservation_discounts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_resdisc_promo` (`promo_code_id`);

--
-- Indexes for table `reservation_events`
--
ALTER TABLE `reservation_events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_reservation` (`reservation_id`);

--
-- Indexes for table `reservation_intents`
--
ALTER TABLE `reservation_intents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_intents_trip` (`trip_id`),
  ADD KEY `idx_intents_seat` (`seat_id`),
  ADD KEY `idx_intents_expires` (`expires_at`);

--
-- Indexes for table `reservation_pricing`
--
ALTER TABLE `reservation_pricing`
  ADD PRIMARY KEY (`reservation_id`);

--
-- Indexes for table `routes`
--
ALTER TABLE `routes`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `route_schedules`
--
ALTER TABLE `route_schedules`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_route_time_dir_op` (`route_id`,`departure`,`direction`,`operator_id`);

--
-- Indexes for table `route_schedule_discounts`
--
ALTER TABLE `route_schedule_discounts`
  ADD PRIMARY KEY (`discount_type_id`,`route_schedule_id`);

--
-- Indexes for table `route_schedule_pricing_categories`
--
ALTER TABLE `route_schedule_pricing_categories`
  ADD PRIMARY KEY (`route_schedule_id`,`pricing_category_id`),
  ADD KEY `route_schedule_pricing_categories_category_id_idx` (`pricing_category_id`);

--
-- Indexes for table `route_stations`
--
ALTER TABLE `route_stations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_route_station` (`route_id`,`station_id`),
  ADD KEY `idx_route_seq` (`route_id`,`sequence`),
  ADD KEY `ix_rs_route_station` (`route_id`,`station_id`),
  ADD KEY `ix_rs_route_sequence` (`route_id`,`sequence`);

--
-- Indexes for table `schedule_exceptions`
--
ALTER TABLE `schedule_exceptions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_schedule` (`schedule_id`),
  ADD KEY `idx_exception_date` (`exception_date`),
  ADD KEY `idx_weekday` (`weekday`),
  ADD KEY `idx_sched_date_week` (`schedule_id`,`exception_date`,`weekday`);

--
-- Indexes for table `seats`
--
ALTER TABLE `seats`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_vehicle_grid` (`vehicle_id`,`row`,`seat_col`),
  ADD UNIQUE KEY `uq_vehicle_label` (`vehicle_id`,`label`) USING HASH,
  ADD KEY `idx_pair` (`vehicle_id`,`pair_id`);

--
-- Indexes for table `seat_locks`
--
ALTER TABLE `seat_locks`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_hold_token` (`hold_token`),
  ADD KEY `idx_seatlocks_trip` (`trip_id`),
  ADD KEY `idx_seatlocks_seat` (`seat_id`);

--
-- Indexes for table `sessions`
--
ALTER TABLE `sessions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `token_hash` (`token_hash`),
  ADD KEY `idx_sessions_emp` (`employee_id`),
  ADD KEY `idx_sessions_exp` (`expires_at`);

--
-- Indexes for table `stations`
--
ALTER TABLE `stations`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `traveler_defaults`
--
ALTER TABLE `traveler_defaults`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_phone_route_dir` (`phone`,`route_id`,`direction`),
  ADD KEY `idx_phone_stations` (`phone`,`board_station_id`,`exit_station_id`),
  ADD KEY `ix_td_read` (`phone`,`route_id`,`direction`,`use_count`,`last_used_at`,`board_station_id`,`exit_station_id`);

--
-- Indexes for table `trips`
--
ALTER TABLE `trips`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_trips_route_date_time_vehicle` (`route_id`,`date`,`time`,`vehicle_id`);

--
-- Indexes for table `trip_stations`
--
ALTER TABLE `trip_stations`
  ADD PRIMARY KEY (`trip_id`,`station_id`),
  ADD UNIQUE KEY `uq_trip_seq` (`trip_id`,`sequence`),
  ADD KEY `fk_ts_station` (`station_id`);

--
-- Indexes for table `trip_vehicles`
--
ALTER TABLE `trip_vehicles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_tv_trip_vehicle` (`trip_id`,`vehicle_id`),
  ADD KEY `idx_tv_trip` (`trip_id`),
  ADD KEY `idx_tv_vehicle` (`vehicle_id`);

--
-- Indexes for table `trip_vehicle_employees`
--
ALTER TABLE `trip_vehicle_employees`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_tve_trip_employee` (`trip_vehicle_id`,`employee_id`),
  ADD KEY `idx_tve_trip_vehicle_id` (`trip_vehicle_id`),
  ADD KEY `idx_tve_employee_id` (`employee_id`);

--
-- Indexes for table `user_preferences`
--
ALTER TABLE `user_preferences`
  ADD PRIMARY KEY (`user_id`);

--
-- Indexes for table `user_route_order`
--
ALTER TABLE `user_route_order`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_user_route` (`user_id`,`route_id`),
  ADD KEY `idx_user_pos` (`user_id`,`position_idx`);

--
-- Indexes for table `vehicles`
--
ALTER TABLE `vehicles`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `agencies`
--
ALTER TABLE `agencies`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `audit_logs`
--
ALTER TABLE `audit_logs`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `employees`
--
ALTER TABLE `employees`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `idempotency_keys`
--
ALTER TABLE `idempotency_keys`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `invitations`
--
ALTER TABLE `invitations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `no_shows`
--
ALTER TABLE `no_shows`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `operators`
--
ALTER TABLE `operators`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `payments`
--
ALTER TABLE `payments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `people`
--
ALTER TABLE `people`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT for table `price_lists`
--
ALTER TABLE `price_lists`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `price_list_items`
--
ALTER TABLE `price_list_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `pricing_categories`
--
ALTER TABLE `pricing_categories`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `promo_codes`
--
ALTER TABLE `promo_codes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `promo_code_usages`
--
ALTER TABLE `promo_code_usages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `reservations`
--
ALTER TABLE `reservations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT for table `reservations_backup`
--
ALTER TABLE `reservations_backup`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `reservation_discounts`
--
ALTER TABLE `reservation_discounts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `reservation_events`
--
ALTER TABLE `reservation_events`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `reservation_intents`
--
ALTER TABLE `reservation_intents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=148;

--
-- AUTO_INCREMENT for table `routes`
--
ALTER TABLE `routes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `route_schedules`
--
ALTER TABLE `route_schedules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `route_stations`
--
ALTER TABLE `route_stations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `schedule_exceptions`
--
ALTER TABLE `schedule_exceptions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `seats`
--
ALTER TABLE `seats`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=45;

--
-- AUTO_INCREMENT for table `sessions`
--
ALTER TABLE `sessions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `stations`
--
ALTER TABLE `stations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `traveler_defaults`
--
ALTER TABLE `traveler_defaults`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `trips`
--
ALTER TABLE `trips`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=732;

--
-- AUTO_INCREMENT for table `trip_vehicles`
--
ALTER TABLE `trip_vehicles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=732;

--
-- AUTO_INCREMENT for table `trip_vehicle_employees`
--
ALTER TABLE `trip_vehicle_employees`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `user_route_order`
--
ALTER TABLE `user_route_order`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `vehicles`
--
ALTER TABLE `vehicles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `invitations`
--
ALTER TABLE `invitations`
  ADD CONSTRAINT `fk_inv_operator` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `promo_code_routes`
--
ALTER TABLE `promo_code_routes`
  ADD CONSTRAINT `fk_promo_routes_code` FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `promo_code_schedules`
--
ALTER TABLE `promo_code_schedules`
  ADD CONSTRAINT `fk_promo_sched_code` FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `promo_code_usages`
--
ALTER TABLE `promo_code_usages`
  ADD CONSTRAINT `fk_promo_usages_code` FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `promo_code_weekdays`
--
ALTER TABLE `promo_code_weekdays`
  ADD CONSTRAINT `fk_promo_weekdays_code` FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `reservation_discounts`
--
ALTER TABLE `reservation_discounts`
  ADD CONSTRAINT `fk_resdisc_promo` FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`);

--
-- Constraints for table `reservation_events`
--
ALTER TABLE `reservation_events`
  ADD CONSTRAINT `fk_reservation_events_res` FOREIGN KEY (`reservation_id`) REFERENCES `reservations` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `route_schedule_pricing_categories`
--
ALTER TABLE `route_schedule_pricing_categories`
  ADD CONSTRAINT `fk_rspc_category` FOREIGN KEY (`pricing_category_id`) REFERENCES `pricing_categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_rspc_schedule` FOREIGN KEY (`route_schedule_id`) REFERENCES `route_schedules` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `schedule_exceptions`
--
ALTER TABLE `schedule_exceptions`
  ADD CONSTRAINT `fk_se_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `route_schedules` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `sessions`
--
ALTER TABLE `sessions`
  ADD CONSTRAINT `fk_sess_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `public_user_sessions`
--
ALTER TABLE `public_user_sessions`
  ADD CONSTRAINT `fk_public_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `public_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `public_user_phone_links`
--
ALTER TABLE `public_user_phone_links`
  ADD CONSTRAINT `fk_public_phone_user` FOREIGN KEY (`user_id`) REFERENCES `public_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_public_phone_person` FOREIGN KEY (`person_id`) REFERENCES `people` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `trip_stations`
--
ALTER TABLE `trip_stations`
  ADD CONSTRAINT `fk_ts_station` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_ts_trip` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

DELIMITER $$
--
-- Events
--
DROP EVENT IF EXISTS `ev_cleanup_reservation_intents`$$
CREATE DEFINER=`priscomr`@`localhost` EVENT `ev_cleanup_reservation_intents` ON SCHEDULE EVERY 1 MINUTE STARTS '2025-10-29 19:18:35' ON COMPLETION NOT PRESERVE ENABLE DO DELETE FROM reservation_intents WHERE expires_at <= NOW()$$

DELIMITER ;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
