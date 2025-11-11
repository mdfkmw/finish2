-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Nov 11, 2025 at 12:10 PM
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

DELIMITER $$
--
-- Procedures
--
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

CREATE TABLE `agencies` (
  `id` int(11) NOT NULL,
  `name` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `agent_chat_messages`
--

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

--
-- Dumping data for table `agent_chat_messages`
--

INSERT INTO `agent_chat_messages` (`id`, `user_id`, `author_name`, `role`, `content`, `attachment_url`, `attachment_type`, `created_at`) VALUES
(0, 4, 'Roșu Cristina Adriana', 'admin', 'Salut!', NULL, NULL, '2025-11-10 12:31:33');

-- --------------------------------------------------------

--
-- Table structure for table `app_settings`
--

CREATE TABLE `app_settings` (
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audit_logs`
--

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
(10, '2025-11-07 10:44:55', 1, 'reservation', 19, 'reservation.create', 'reservation', NULL, '6d2a417c-08a4-44d8-85e0-72045fb13476', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(11, '2025-11-07 11:12:23', 1, 'reservation', 20, 'reservation.create', 'reservation', NULL, 'a2f77a95-e21b-4891-9a01-70b1515c137a', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(12, '2025-11-07 11:22:08', 1, 'reservation', 21, 'reservation.create', 'reservation', NULL, '4f9a2526-5c17-4b4d-b301-38fdddec962a', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(13, '2025-11-07 11:26:53', 1, 'reservation', 22, 'reservation.create', 'reservation', NULL, '5cb62ab6-369f-43c9-8200-75ed4645d562', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(14, '2025-11-07 11:36:41', 1, 'reservation', 23, 'reservation.create', 'reservation', NULL, 'bb5d0654-c818-4f14-9823-2b4830b74b7e', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(15, '2025-11-07 11:57:29', 1, 'reservation', 24, 'reservation.create', 'reservation', NULL, '8849a9f9-c4f9-404c-8ca4-90c7deb98b57', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(16, '2025-11-07 11:57:31', 1, 'payment', 24, 'payment.capture', 'reservation', NULL, 'b0ded416-61f6-4881-98e4-b2034aaba0fd', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(17, '2025-11-07 11:57:54', 1, 'payment', 23, 'payment.capture', 'reservation', NULL, '729e5681-7041-4f3d-a31a-1c7ef174d3bb', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(18, '2025-11-07 11:59:44', 1, 'reservation', 25, 'reservation.create', 'reservation', NULL, '629e2461-eef0-4553-8a4b-402598272717', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(19, '2025-11-07 11:59:49', 1, 'payment', 25, 'payment.capture', 'reservation', NULL, '024a69f3-fd91-4f18-a0c6-039eae482ca9', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(20, '2025-11-07 12:00:04', 1, 'reservation', 26, 'reservation.create', 'reservation', NULL, '117f39fb-2a5a-42b1-8a6d-777c62b348ac', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(21, '2025-11-07 12:00:06', 1, 'payment', 26, 'payment.capture', 'reservation', NULL, 'eff3f243-504b-486c-8938-b14b3b9d55ef', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(22, '2025-11-07 12:31:24', 1, 'reservation', 27, 'reservation.create', 'reservation', NULL, 'e109ba4a-2d10-4a16-b1df-b6bf8cb99e5a', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(23, '2025-11-07 12:32:06', 1, 'payment', 27, 'payment.capture', 'reservation', NULL, '22043e7f-36c5-4f6d-8c2a-c5d6ba2b8765', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(24, '2025-11-07 16:36:37', 1, 'reservation', 28, 'reservation.create', 'reservation', NULL, '25496451-511e-423f-a6a4-b29ac5868a2d', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(25, '2025-11-07 16:37:00', 1, 'payment', 28, 'payment.capture', 'reservation', NULL, 'a4f322e2-2a09-4723-ba87-18aa6747a4c8', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(26, '2025-11-07 16:37:05', 1, 'payment', 22, 'payment.capture', 'reservation', NULL, '8768d88c-4f10-4afd-8f32-700ef9b1fa84', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(27, '2025-11-07 16:37:09', 1, 'payment', 19, 'payment.capture', 'reservation', NULL, '3aad4c5e-2c2b-4b1f-87fc-1529526bcc05', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(28, '2025-11-07 16:37:20', 1, 'reservation', 29, 'reservation.create', 'reservation', NULL, 'e7301569-c6a6-4ca1-958b-b0b81dac0481', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(29, '2025-11-07 16:37:20', 1, 'reservation', 30, 'reservation.create', 'reservation', NULL, 'cb6385b0-c83e-437b-b6ec-1efd25f299fa', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(30, '2025-11-07 16:37:20', 1, 'reservation', 31, 'reservation.create', 'reservation', NULL, '8319efcf-cae3-4833-b4d7-376147bad2f2', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(31, '2025-11-07 16:37:20', 1, 'reservation', 32, 'reservation.create', 'reservation', NULL, 'b75b4646-3142-4c32-9258-6727c9ea15de', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(32, '2025-11-07 16:37:24', 1, 'payment', 29, 'payment.capture', 'reservation', NULL, '9a0dcd63-377b-440e-850f-313ae4247988', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(33, '2025-11-07 16:37:27', 1, 'payment', 30, 'payment.capture', 'reservation', NULL, '76261838-1a7b-43c7-afae-db71d3093103', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(34, '2025-11-07 16:37:30', 1, 'payment', 31, 'payment.capture', 'reservation', NULL, '5c0b5529-0566-455e-be02-23fbf23ea3c8', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL),
(35, '2025-11-07 16:37:33', 1, 'payment', 32, 'payment.capture', 'reservation', NULL, 'b9c445ab-8cb3-42b7-9150-32fe7762d517', NULL, 0.10, 'cash', NULL, NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `blacklist`
--

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

CREATE TABLE `discount_types` (
  `id` int(11) NOT NULL,
  `code` varchar(50) NOT NULL,
  `label` text NOT NULL,
  `value_off` decimal(5,2) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `type` enum('percent','fixed') NOT NULL DEFAULT 'percent'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `discount_types`
--

INSERT INTO `discount_types` (`id`, `code`, `label`, `value_off`, `created_at`, `type`) VALUES
(1, 'Pen', 'Pensionar', 50.00, '2025-11-10 21:34:44', 'percent'),
(2, 'DAS', 'DAS', 100.00, '2025-11-10 21:35:28', 'percent'),
(3, 'Cop10', 'Copil < 10 ani', 50.00, '2025-11-11 08:46:53', 'percent'),
(4, 'Cop12', 'Copil < 12 ani', 50.00, '2025-11-11 08:47:16', 'percent');

-- --------------------------------------------------------

--
-- Table structure for table `employees`
--

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
(1, 'admin', NULL, '0743171315', NULL, '$2a$12$eZZLP5AOlQJuOl/5ctwDeOp0avF8iY5zfIadvp1v7P9U7oTZDoPfe', 'admin', 1, '2025-08-04 13:46:37', 2, 1),
(2, 'lavinia', NULL, '0742852790', NULL, '$2a$12$qw5jN.PIZnNt05E13z5kQ.jrEbNUyxe6nl.vywLHPC3ivk6LYuLr.', 'agent', 1, '2025-10-24 15:56:33', 2, 1),
(4, 'Roșu Cristina Adriana', 'Cristina Adriana', NULL, 'cristina_adriana862009@yahoo.com', '$2a$12$aWOE/xRMlROkraeU.2lqFexQsnctkz/s7XsiANV.FBZo4kP3eYmPC', 'admin', 1, '2025-11-10 14:30:53', 2, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `idempotency_keys`
--

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
(2, 1, '9d7de625-1a94-4d4e-b054-316aefc7e3a2', 19, '2025-11-07 10:44:55'),
(3, 1, '843275c1-6a65-4f1c-98c9-ea0324cc4fdc', 20, '2025-11-07 11:12:23'),
(4, 1, '9637abc7-f86c-4a56-8cf2-def38d229d31', 21, '2025-11-07 11:22:08'),
(5, 1, '289261ef-a100-490a-bef0-869cf9153bb1', 22, '2025-11-07 11:26:53'),
(6, 1, 'b947258f-8e2c-492d-b85f-bb3eda396696', 23, '2025-11-07 11:36:41'),
(7, 1, 'bc4c7128-46c3-406b-88c0-2fdef7e0a1a5', 24, '2025-11-07 11:57:29'),
(8, 1, '95676f33-6979-481d-8370-a4d751e5e030', 25, '2025-11-07 11:59:44'),
(9, 1, '52e5387d-214c-4186-9dea-2f6dd400ada5', 26, '2025-11-07 12:00:04'),
(10, 1, '7e1a1f79-8600-46cc-9152-3dabba9cffe3', 27, '2025-11-07 12:31:24'),
(11, 1, '57494602-a152-4977-af1c-249a2df88c6d', 28, '2025-11-07 16:36:37'),
(12, 1, 'e28247d3-a061-40d2-901d-ec3e6b6e3766', 29, '2025-11-07 16:37:20');

-- --------------------------------------------------------

--
-- Table structure for table `invitations`
--

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

--
-- Dumping data for table `invitations`
--

INSERT INTO `invitations` (`id`, `token`, `role`, `operator_id`, `email`, `expires_at`, `created_by`, `used_at`, `used_by`) VALUES
(1, 'Ao8r2E3I12pnKWe393Q1yzO-HbIcOaRVzAy8MzZlQAY', 'agent', 2, 'rosuiulian@gmail.com', '2025-11-13 12:43:00', 1, '2025-11-10 12:45:56', 3),
(2, 'HFr65KnUBJVYC-NtCAUhChASzDvHlNQhwAHfvVSZ7rc', 'agent', 2, 'rosuiulian@gmail.com', '2025-11-13 13:00:36', 1, NULL, NULL),
(3, '2VWdTU2S4HJuUNC0TPyixC82_EMWO4sQz677L523kSo', 'agent', 2, 'madafaka_mw@yahoo.com', '2025-11-13 13:59:27', 1, NULL, NULL),
(4, 'DtSQOE8n1Dgy0yw0z-WVKT4vsecjv3RTXHambyugNw0', 'agent', 2, 'madafaka_mw@yahoo.com', '2025-11-13 14:07:46', 1, NULL, NULL),
(5, 'cMrhJhReoJW04e0gJ0i3cawiw6QQUGeCDoBbAq26COQ', 'agent', 2, 'madafaka_mw@yahoo.com', '2025-11-13 14:11:17', 1, NULL, NULL),
(6, 'RxZ3mZdw9KFx9UObkLE9jsgtIv6LIaPAeGUACXM8GHE', 'admin', 2, 'cristina_adriana862009@yahoo.com', '2025-11-13 14:12:45', 1, '2025-11-10 14:30:53', 4);

-- --------------------------------------------------------

--
-- Table structure for table `no_shows`
--

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

--
-- Dumping data for table `payments`
--

INSERT INTO `payments` (`id`, `reservation_id`, `amount`, `status`, `payment_method`, `transaction_id`, `timestamp`, `deposited_at`, `deposited_by`, `collected_by`, `cash_handover_id`) VALUES
(1, 24, 0.10, 'paid', 'cash', NULL, '2025-11-07 11:57:31', NULL, NULL, 1, NULL),
(2, 23, 0.10, 'paid', 'cash', NULL, '2025-11-07 11:57:54', NULL, NULL, 1, NULL),
(3, 25, 0.10, 'paid', 'cash', NULL, '2025-11-07 11:59:49', NULL, NULL, 1, NULL),
(4, 26, 0.10, 'paid', 'cash', NULL, '2025-11-07 12:00:06', NULL, NULL, 1, NULL),
(5, 27, 0.10, 'paid', 'cash', NULL, '2025-11-07 12:32:06', NULL, NULL, 1, NULL),
(6, 28, 0.10, 'paid', 'cash', NULL, '2025-11-07 16:37:00', NULL, NULL, 1, NULL),
(7, 22, 0.10, 'paid', 'cash', NULL, '2025-11-07 16:37:05', NULL, NULL, 1, NULL),
(8, 19, 0.10, 'paid', 'cash', NULL, '2025-11-07 16:37:09', NULL, NULL, 1, NULL),
(9, 29, 0.10, 'paid', 'cash', NULL, '2025-11-07 16:37:24', NULL, NULL, 1, NULL),
(10, 30, 0.10, 'paid', 'cash', NULL, '2025-11-07 16:37:27', NULL, NULL, 1, NULL),
(11, 31, 0.10, 'paid', 'cash', NULL, '2025-11-07 16:37:30', NULL, NULL, 1, NULL),
(12, 32, 0.10, 'paid', 'cash', NULL, '2025-11-07 16:37:33', NULL, NULL, 1, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `people`
--

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
(8, 'test3', NULL, 'active', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, '2025-11-07 10:44:55'),
(9, 'test2', NULL, 'active', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, '2025-11-07 11:26:53'),
(10, 'test4', NULL, 'active', NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, '2025-11-07 12:00:04');

-- --------------------------------------------------------

--
-- Table structure for table `price_lists`
--

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
(3, '1-1-2025-11-07', 1, '2025-11-07', 1, '2025-11-07 09:03:46', 1, 1),
(4, '3-1-2025-11-10', 1, '2025-11-10', 1, '2025-11-10 15:24:00', 3, 1),
(5, '3-2-2025-11-10', 1, '2025-11-10', 1, '2025-11-10 15:25:53', 3, 2),
(6, '4-1-2025-11-10', 1, '2025-11-10', 1, '2025-11-10 15:49:59', 4, 1),
(7, '4-2-2025-11-10', 1, '2025-11-10', 1, '2025-11-10 15:50:38', 4, 2),
(8, '5-1-2025-11-11', 1, '2025-11-11', 1, '2025-11-11 10:06:52', 5, 1),
(9, '5-2-2025-11-11', 1, '2025-11-11', 1, '2025-11-11 10:07:10', 5, 2);

-- --------------------------------------------------------

--
-- Table structure for table `price_list_items`
--

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
(6, 0.10, 'RON', NULL, 3, 2, 1),
(7, 7.00, 'RON', NULL, 4, 45, 44),
(8, 7.00, 'RON', NULL, 4, 44, 45),
(9, 9.00, 'RON', NULL, 4, 45, 43),
(10, 9.00, 'RON', NULL, 4, 43, 45),
(11, 12.00, 'RON', NULL, 4, 45, 42),
(12, 12.00, 'RON', NULL, 4, 42, 45),
(13, 13.00, 'RON', NULL, 4, 45, 41),
(14, 13.00, 'RON', NULL, 4, 41, 45),
(15, 15.00, 'RON', NULL, 4, 45, 40),
(16, 15.00, 'RON', NULL, 4, 40, 45),
(17, 15.00, 'RON', NULL, 4, 45, 39),
(18, 15.00, 'RON', NULL, 4, 39, 45),
(19, 20.00, 'RON', NULL, 4, 45, 38),
(20, 20.00, 'RON', NULL, 4, 38, 45),
(21, 22.00, 'RON', NULL, 4, 45, 37),
(22, 22.00, 'RON', NULL, 4, 37, 45),
(23, 24.00, 'RON', NULL, 4, 45, 36),
(24, 24.00, 'RON', NULL, 4, 36, 45),
(25, 26.00, 'RON', NULL, 4, 45, 35),
(26, 26.00, 'RON', NULL, 4, 35, 45),
(27, 28.00, 'RON', NULL, 4, 45, 34),
(28, 28.00, 'RON', NULL, 4, 34, 45),
(29, 29.00, 'RON', NULL, 4, 45, 33),
(30, 29.00, 'RON', NULL, 4, 33, 45),
(31, 30.00, 'RON', NULL, 4, 45, 32),
(32, 30.00, 'RON', NULL, 4, 32, 45),
(33, 31.00, 'RON', NULL, 4, 45, 31),
(34, 31.00, 'RON', NULL, 4, 31, 45),
(35, 32.00, 'RON', NULL, 4, 45, 30),
(36, 32.00, 'RON', NULL, 4, 30, 45),
(37, 33.00, 'RON', NULL, 4, 45, 1),
(38, 33.00, 'RON', NULL, 4, 1, 45),
(39, 35.00, 'RON', NULL, 4, 45, 29),
(40, 35.00, 'RON', NULL, 4, 29, 45),
(41, 36.00, 'RON', NULL, 4, 45, 28),
(42, 36.00, 'RON', NULL, 4, 28, 45),
(43, 37.00, 'RON', NULL, 4, 45, 27),
(44, 37.00, 'RON', NULL, 4, 27, 45),
(45, 39.00, 'RON', NULL, 4, 45, 26),
(46, 39.00, 'RON', NULL, 4, 26, 45),
(47, 39.00, 'RON', NULL, 4, 45, 25),
(48, 39.00, 'RON', NULL, 4, 25, 45),
(49, 39.00, 'RON', NULL, 4, 45, 6),
(50, 39.00, 'RON', NULL, 4, 6, 45),
(51, 40.00, 'RON', NULL, 4, 45, 7),
(52, 40.00, 'RON', NULL, 4, 7, 45),
(53, 41.00, 'RON', NULL, 4, 45, 8),
(54, 41.00, 'RON', NULL, 4, 8, 45),
(55, 42.00, 'RON', NULL, 4, 45, 4),
(56, 42.00, 'RON', NULL, 4, 4, 45),
(57, 45.00, 'RON', NULL, 4, 45, 9),
(58, 45.00, 'RON', NULL, 4, 9, 45),
(59, 47.00, 'RON', NULL, 4, 45, 5),
(60, 47.00, 'RON', NULL, 4, 5, 45),
(61, 51.00, 'RON', NULL, 4, 45, 24),
(62, 51.00, 'RON', NULL, 4, 24, 45),
(63, 52.00, 'RON', NULL, 4, 45, 3),
(64, 52.00, 'RON', NULL, 4, 3, 45),
(65, 52.00, 'RON', NULL, 4, 45, 23),
(66, 52.00, 'RON', NULL, 4, 23, 45),
(67, 53.00, 'RON', NULL, 4, 45, 22),
(68, 53.00, 'RON', NULL, 4, 22, 45),
(69, 54.00, 'RON', NULL, 4, 45, 21),
(70, 54.00, 'RON', NULL, 4, 21, 45),
(71, 55.00, 'RON', NULL, 4, 45, 10),
(72, 55.00, 'RON', NULL, 4, 10, 45),
(73, 56.00, 'RON', NULL, 4, 45, 11),
(74, 56.00, 'RON', NULL, 4, 11, 45),
(75, 56.00, 'RON', NULL, 4, 45, 12),
(76, 56.00, 'RON', NULL, 4, 12, 45),
(77, 57.00, 'RON', NULL, 4, 45, 20),
(78, 57.00, 'RON', NULL, 4, 20, 45),
(79, 57.00, 'RON', NULL, 4, 45, 19),
(80, 57.00, 'RON', NULL, 4, 19, 45),
(81, 58.00, 'RON', NULL, 4, 45, 18),
(82, 58.00, 'RON', NULL, 4, 18, 45),
(83, 59.00, 'RON', NULL, 4, 45, 17),
(84, 59.00, 'RON', NULL, 4, 17, 45),
(85, 61.00, 'RON', NULL, 4, 45, 16),
(86, 61.00, 'RON', NULL, 4, 16, 45),
(87, 62.00, 'RON', NULL, 4, 45, 15),
(88, 62.00, 'RON', NULL, 4, 15, 45),
(89, 63.00, 'RON', NULL, 4, 45, 14),
(90, 63.00, 'RON', NULL, 4, 14, 45),
(91, 35.00, 'RON', NULL, 4, 45, 13),
(92, 35.00, 'RON', NULL, 4, 13, 45),
(93, 68.00, 'RON', NULL, 4, 45, 2),
(94, 68.00, 'RON', NULL, 4, 2, 45),
(95, 68.00, 'RON', NULL, 5, 45, 2),
(96, 68.00, 'RON', NULL, 5, 2, 45),
(97, 50.00, 'RON', NULL, 6, 46, 2),
(98, 50.00, 'RON', NULL, 6, 2, 46),
(101, 50.00, 'RON', NULL, 7, 46, 2),
(102, 50.00, 'RON', NULL, 7, 2, 46),
(103, 48.00, 'RON', NULL, 7, 1, 2),
(104, 48.00, 'RON', NULL, 7, 2, 1),
(107, 140.00, 'RON', NULL, 9, 1, 80),
(108, 140.00, 'RON', NULL, 9, 80, 1),
(6166, 6.00, 'RON', NULL, 8, 1, 29),
(6167, 8.00, 'RON', NULL, 8, 1, 28),
(6168, 10.00, 'RON', NULL, 8, 1, 27),
(6169, 11.00, 'RON', NULL, 8, 1, 26),
(6170, 12.00, 'RON', NULL, 8, 1, 25),
(6171, 12.00, 'RON', NULL, 8, 1, 6),
(6172, 14.00, 'RON', NULL, 8, 1, 7),
(6173, 15.00, 'RON', NULL, 8, 1, 8),
(6174, 16.00, 'RON', NULL, 8, 1, 4),
(6175, 17.00, 'RON', NULL, 8, 1, 9),
(6176, 18.00, 'RON', NULL, 8, 1, 5),
(6177, 21.00, 'RON', NULL, 8, 1, 24),
(6178, 23.00, 'RON', NULL, 8, 1, 3),
(6179, 23.00, 'RON', NULL, 8, 1, 23),
(6180, 24.00, 'RON', NULL, 8, 1, 22),
(6181, 24.00, 'RON', NULL, 8, 1, 21),
(6182, 25.00, 'RON', NULL, 8, 1, 10),
(6183, 26.00, 'RON', NULL, 8, 1, 11),
(6184, 28.00, 'RON', NULL, 8, 1, 12),
(6185, 30.00, 'RON', NULL, 8, 1, 20),
(6186, 35.00, 'RON', NULL, 8, 1, 55),
(6187, 45.00, 'RON', NULL, 8, 1, 56),
(6188, 50.00, 'RON', NULL, 8, 1, 57),
(6189, 55.00, 'RON', NULL, 8, 1, 58),
(6190, 60.00, 'RON', NULL, 8, 1, 59),
(6191, 60.00, 'RON', NULL, 8, 1, 60),
(6192, 65.00, 'RON', NULL, 8, 1, 61),
(6193, 70.00, 'RON', NULL, 8, 1, 62),
(6194, 75.00, 'RON', NULL, 8, 1, 63),
(6195, 80.00, 'RON', NULL, 8, 1, 64),
(6196, 85.00, 'RON', NULL, 8, 1, 65),
(6197, 100.00, 'RON', NULL, 8, 1, 66),
(6198, 100.00, 'RON', NULL, 8, 1, 67),
(6199, 105.00, 'RON', NULL, 8, 1, 68),
(6200, 110.00, 'RON', NULL, 8, 1, 69),
(6201, 115.00, 'RON', NULL, 8, 1, 70),
(6202, 115.00, 'RON', NULL, 8, 1, 71),
(6203, 120.00, 'RON', NULL, 8, 1, 72),
(6204, 120.00, 'RON', NULL, 8, 1, 73),
(6205, 125.00, 'RON', NULL, 8, 1, 74),
(6206, 125.00, 'RON', NULL, 8, 1, 75),
(6207, 130.00, 'RON', NULL, 8, 1, 76),
(6208, 135.00, 'RON', NULL, 8, 1, 77),
(6209, 140.00, 'RON', NULL, 8, 1, 78),
(6210, 140.00, 'RON', NULL, 8, 1, 79),
(6211, 140.00, 'RON', NULL, 8, 1, 80),
(6212, 140.00, 'RON', NULL, 8, 80, 1),
(6213, 5.00, 'RON', NULL, 8, 29, 28),
(6214, 8.00, 'RON', NULL, 8, 29, 27),
(6215, 9.00, 'RON', NULL, 8, 29, 26),
(6216, 10.00, 'RON', NULL, 8, 29, 25),
(6217, 11.00, 'RON', NULL, 8, 29, 6),
(6218, 12.00, 'RON', NULL, 8, 29, 7),
(6219, 13.00, 'RON', NULL, 8, 29, 8),
(6220, 14.00, 'RON', NULL, 8, 29, 4),
(6221, 15.00, 'RON', NULL, 8, 29, 9),
(6222, 16.00, 'RON', NULL, 8, 29, 5),
(6223, 20.00, 'RON', NULL, 8, 29, 24),
(6224, 21.00, 'RON', NULL, 8, 29, 3),
(6225, 23.00, 'RON', NULL, 8, 29, 23),
(6226, 24.00, 'RON', NULL, 8, 29, 22),
(6227, 24.00, 'RON', NULL, 8, 29, 21),
(6228, 25.00, 'RON', NULL, 8, 29, 10),
(6229, 26.00, 'RON', NULL, 8, 29, 11),
(6230, 28.00, 'RON', NULL, 8, 29, 12),
(6231, 30.00, 'RON', NULL, 8, 29, 20),
(6232, 35.00, 'RON', NULL, 8, 29, 55),
(6233, 45.00, 'RON', NULL, 8, 29, 56),
(6234, 50.00, 'RON', NULL, 8, 29, 57),
(6235, 55.00, 'RON', NULL, 8, 29, 58),
(6236, 60.00, 'RON', NULL, 8, 29, 59),
(6237, 60.00, 'RON', NULL, 8, 29, 60),
(6238, 65.00, 'RON', NULL, 8, 29, 61),
(6239, 70.00, 'RON', NULL, 8, 29, 62),
(6240, 75.00, 'RON', NULL, 8, 29, 63),
(6241, 80.00, 'RON', NULL, 8, 29, 64),
(6242, 85.00, 'RON', NULL, 8, 29, 65),
(6243, 95.00, 'RON', NULL, 8, 29, 66),
(6244, 100.00, 'RON', NULL, 8, 29, 67),
(6245, 105.00, 'RON', NULL, 8, 29, 68),
(6246, 110.00, 'RON', NULL, 8, 29, 69),
(6247, 115.00, 'RON', NULL, 8, 29, 70),
(6248, 115.00, 'RON', NULL, 8, 29, 71),
(6249, 120.00, 'RON', NULL, 8, 29, 72),
(6250, 120.00, 'RON', NULL, 8, 29, 73),
(6251, 125.00, 'RON', NULL, 8, 29, 74),
(6252, 125.00, 'RON', NULL, 8, 29, 75),
(6253, 130.00, 'RON', NULL, 8, 29, 76),
(6254, 135.00, 'RON', NULL, 8, 29, 77),
(6255, 140.00, 'RON', NULL, 8, 29, 78),
(6256, 140.00, 'RON', NULL, 8, 29, 79),
(6257, 140.00, 'RON', NULL, 8, 29, 80),
(6258, 4.00, 'RON', NULL, 8, 28, 27),
(6259, 5.00, 'RON', NULL, 8, 28, 26),
(6260, 5.00, 'RON', NULL, 8, 28, 25),
(6261, 6.00, 'RON', NULL, 8, 28, 6),
(6262, 10.00, 'RON', NULL, 8, 28, 7),
(6263, 11.00, 'RON', NULL, 8, 28, 8),
(6264, 12.00, 'RON', NULL, 8, 28, 4),
(6265, 13.00, 'RON', NULL, 8, 28, 9),
(6266, 14.00, 'RON', NULL, 8, 28, 5),
(6267, 19.00, 'RON', NULL, 8, 28, 24),
(6268, 20.00, 'RON', NULL, 8, 28, 3),
(6269, 21.00, 'RON', NULL, 8, 28, 23),
(6270, 21.00, 'RON', NULL, 8, 28, 22),
(6271, 21.00, 'RON', NULL, 8, 28, 21),
(6272, 22.00, 'RON', NULL, 8, 28, 10),
(6273, 24.00, 'RON', NULL, 8, 28, 11),
(6274, 25.00, 'RON', NULL, 8, 28, 12),
(6275, 27.00, 'RON', NULL, 8, 28, 20),
(6276, 32.00, 'RON', NULL, 8, 28, 55),
(6277, 42.00, 'RON', NULL, 8, 28, 56),
(6278, 45.00, 'RON', NULL, 8, 28, 57),
(6279, 50.00, 'RON', NULL, 8, 28, 58),
(6280, 55.00, 'RON', NULL, 8, 28, 59),
(6281, 55.00, 'RON', NULL, 8, 28, 60),
(6282, 60.00, 'RON', NULL, 8, 28, 61),
(6283, 65.00, 'RON', NULL, 8, 28, 62),
(6284, 70.00, 'RON', NULL, 8, 28, 63),
(6285, 75.00, 'RON', NULL, 8, 28, 64),
(6286, 80.00, 'RON', NULL, 8, 28, 65),
(6287, 90.00, 'RON', NULL, 8, 28, 66),
(6288, 95.00, 'RON', NULL, 8, 28, 67),
(6289, 100.00, 'RON', NULL, 8, 28, 68),
(6290, 105.00, 'RON', NULL, 8, 28, 69),
(6291, 110.00, 'RON', NULL, 8, 28, 70),
(6292, 110.00, 'RON', NULL, 8, 28, 71),
(6293, 115.00, 'RON', NULL, 8, 28, 72),
(6294, 115.00, 'RON', NULL, 8, 28, 73),
(6295, 120.00, 'RON', NULL, 8, 28, 74),
(6296, 120.00, 'RON', NULL, 8, 28, 75),
(6297, 125.00, 'RON', NULL, 8, 28, 76),
(6298, 130.00, 'RON', NULL, 8, 28, 77),
(6299, 135.00, 'RON', NULL, 8, 28, 78),
(6300, 135.00, 'RON', NULL, 8, 28, 79),
(6301, 140.00, 'RON', NULL, 8, 28, 80),
(6302, 4.00, 'RON', NULL, 8, 27, 26),
(6303, 5.00, 'RON', NULL, 8, 27, 25),
(6304, 5.00, 'RON', NULL, 8, 27, 6),
(6305, 8.00, 'RON', NULL, 8, 27, 7),
(6306, 10.00, 'RON', NULL, 8, 27, 8),
(6307, 11.00, 'RON', NULL, 8, 27, 4),
(6308, 12.00, 'RON', NULL, 8, 27, 9),
(6309, 13.00, 'RON', NULL, 8, 27, 5),
(6310, 17.00, 'RON', NULL, 8, 27, 24),
(6311, 18.00, 'RON', NULL, 8, 27, 3),
(6312, 20.00, 'RON', NULL, 8, 27, 23),
(6313, 20.00, 'RON', NULL, 8, 27, 22),
(6314, 20.00, 'RON', NULL, 8, 27, 21),
(6315, 21.00, 'RON', NULL, 8, 27, 10),
(6316, 23.00, 'RON', NULL, 8, 27, 11),
(6317, 24.00, 'RON', NULL, 8, 27, 12),
(6318, 26.00, 'RON', NULL, 8, 27, 20),
(6319, 31.00, 'RON', NULL, 8, 27, 55),
(6320, 41.00, 'RON', NULL, 8, 27, 56),
(6321, 44.00, 'RON', NULL, 8, 27, 57),
(6322, 49.00, 'RON', NULL, 8, 27, 58),
(6323, 53.00, 'RON', NULL, 8, 27, 59),
(6324, 54.00, 'RON', NULL, 8, 27, 60),
(6325, 59.00, 'RON', NULL, 8, 27, 61),
(6326, 64.00, 'RON', NULL, 8, 27, 62),
(6327, 69.00, 'RON', NULL, 8, 27, 63),
(6328, 74.00, 'RON', NULL, 8, 27, 64),
(6329, 79.00, 'RON', NULL, 8, 27, 65),
(6330, 89.00, 'RON', NULL, 8, 27, 66),
(6331, 94.00, 'RON', NULL, 8, 27, 67),
(6332, 99.00, 'RON', NULL, 8, 27, 68),
(6333, 104.00, 'RON', NULL, 8, 27, 69),
(6334, 109.00, 'RON', NULL, 8, 27, 70),
(6335, 109.00, 'RON', NULL, 8, 27, 71),
(6336, 113.00, 'RON', NULL, 8, 27, 72),
(6337, 114.00, 'RON', NULL, 8, 27, 73),
(6338, 119.00, 'RON', NULL, 8, 27, 74),
(6339, 119.00, 'RON', NULL, 8, 27, 75),
(6340, 124.00, 'RON', NULL, 8, 27, 76),
(6341, 129.00, 'RON', NULL, 8, 27, 77),
(6342, 134.00, 'RON', NULL, 8, 27, 78),
(6343, 134.00, 'RON', NULL, 8, 27, 79),
(6344, 140.00, 'RON', NULL, 8, 27, 80),
(6345, 4.00, 'RON', NULL, 8, 26, 25),
(6346, 5.00, 'RON', NULL, 8, 26, 6),
(6347, 7.00, 'RON', NULL, 8, 26, 7),
(6348, 8.00, 'RON', NULL, 8, 26, 8),
(6349, 10.00, 'RON', NULL, 8, 26, 4),
(6350, 12.00, 'RON', NULL, 8, 26, 9),
(6351, 13.00, 'RON', NULL, 8, 26, 5),
(6352, 17.00, 'RON', NULL, 8, 26, 24),
(6353, 18.00, 'RON', NULL, 8, 26, 3),
(6354, 20.00, 'RON', NULL, 8, 26, 23),
(6355, 20.00, 'RON', NULL, 8, 26, 22),
(6356, 20.00, 'RON', NULL, 8, 26, 21),
(6357, 21.00, 'RON', NULL, 8, 26, 10),
(6358, 23.00, 'RON', NULL, 8, 26, 11),
(6359, 24.00, 'RON', NULL, 8, 26, 12),
(6360, 26.00, 'RON', NULL, 8, 26, 20),
(6361, 31.00, 'RON', NULL, 8, 26, 55),
(6362, 41.00, 'RON', NULL, 8, 26, 56),
(6363, 44.00, 'RON', NULL, 8, 26, 57),
(6364, 49.00, 'RON', NULL, 8, 26, 58),
(6365, 53.00, 'RON', NULL, 8, 26, 59),
(6366, 54.00, 'RON', NULL, 8, 26, 60),
(6367, 59.00, 'RON', NULL, 8, 26, 61),
(6368, 64.00, 'RON', NULL, 8, 26, 62),
(6369, 69.00, 'RON', NULL, 8, 26, 63),
(6370, 74.00, 'RON', NULL, 8, 26, 64),
(6371, 79.00, 'RON', NULL, 8, 26, 65),
(6372, 89.00, 'RON', NULL, 8, 26, 66),
(6373, 94.00, 'RON', NULL, 8, 26, 67),
(6374, 99.00, 'RON', NULL, 8, 26, 68),
(6375, 104.00, 'RON', NULL, 8, 26, 69),
(6376, 109.00, 'RON', NULL, 8, 26, 70),
(6377, 109.00, 'RON', NULL, 8, 26, 71),
(6378, 113.00, 'RON', NULL, 8, 26, 72),
(6379, 114.00, 'RON', NULL, 8, 26, 73),
(6380, 119.00, 'RON', NULL, 8, 26, 74),
(6381, 119.00, 'RON', NULL, 8, 26, 75),
(6382, 124.00, 'RON', NULL, 8, 26, 76),
(6383, 129.00, 'RON', NULL, 8, 26, 77),
(6384, 134.00, 'RON', NULL, 8, 26, 78),
(6385, 134.00, 'RON', NULL, 8, 26, 79),
(6386, 140.00, 'RON', NULL, 8, 26, 80),
(6387, 4.00, 'RON', NULL, 8, 25, 6),
(6388, 6.00, 'RON', NULL, 8, 25, 7),
(6389, 6.00, 'RON', NULL, 8, 25, 8),
(6390, 9.00, 'RON', NULL, 8, 25, 4),
(6391, 11.00, 'RON', NULL, 8, 25, 9),
(6392, 12.00, 'RON', NULL, 8, 25, 5),
(6393, 16.00, 'RON', NULL, 8, 25, 24),
(6394, 17.00, 'RON', NULL, 8, 25, 3),
(6395, 18.00, 'RON', NULL, 8, 25, 23),
(6396, 19.00, 'RON', NULL, 8, 25, 22),
(6397, 19.00, 'RON', NULL, 8, 25, 21),
(6398, 20.00, 'RON', NULL, 8, 25, 10),
(6399, 22.00, 'RON', NULL, 8, 25, 11),
(6400, 23.00, 'RON', NULL, 8, 25, 12),
(6401, 25.00, 'RON', NULL, 8, 25, 20),
(6402, 30.00, 'RON', NULL, 8, 25, 55),
(6403, 40.00, 'RON', NULL, 8, 25, 56),
(6404, 43.00, 'RON', NULL, 8, 25, 57),
(6405, 48.00, 'RON', NULL, 8, 25, 58),
(6406, 52.00, 'RON', NULL, 8, 25, 59),
(6407, 53.00, 'RON', NULL, 8, 25, 60),
(6408, 58.00, 'RON', NULL, 8, 25, 61),
(6409, 63.00, 'RON', NULL, 8, 25, 62),
(6410, 68.00, 'RON', NULL, 8, 25, 63),
(6411, 73.00, 'RON', NULL, 8, 25, 64),
(6412, 78.00, 'RON', NULL, 8, 25, 65),
(6413, 88.00, 'RON', NULL, 8, 25, 66),
(6414, 93.00, 'RON', NULL, 8, 25, 67),
(6415, 98.00, 'RON', NULL, 8, 25, 68),
(6416, 103.00, 'RON', NULL, 8, 25, 69),
(6417, 108.00, 'RON', NULL, 8, 25, 70),
(6418, 108.00, 'RON', NULL, 8, 25, 71),
(6419, 112.00, 'RON', NULL, 8, 25, 72),
(6420, 113.00, 'RON', NULL, 8, 25, 73),
(6421, 118.00, 'RON', NULL, 8, 25, 74),
(6422, 118.00, 'RON', NULL, 8, 25, 75),
(6423, 123.00, 'RON', NULL, 8, 25, 76),
(6424, 128.00, 'RON', NULL, 8, 25, 77),
(6425, 133.00, 'RON', NULL, 8, 25, 78),
(6426, 133.00, 'RON', NULL, 8, 25, 79),
(6427, 140.00, 'RON', NULL, 8, 25, 80),
(6428, 5.00, 'RON', NULL, 8, 6, 7),
(6429, 5.00, 'RON', NULL, 8, 6, 8),
(6430, 8.00, 'RON', NULL, 8, 6, 4),
(6431, 10.00, 'RON', NULL, 8, 6, 9),
(6432, 11.00, 'RON', NULL, 8, 6, 5),
(6433, 15.00, 'RON', NULL, 8, 6, 24),
(6434, 16.00, 'RON', NULL, 8, 6, 3),
(6435, 17.00, 'RON', NULL, 8, 6, 23),
(6436, 18.00, 'RON', NULL, 8, 6, 22),
(6437, 18.00, 'RON', NULL, 8, 6, 21),
(6438, 19.00, 'RON', NULL, 8, 6, 10),
(6439, 21.00, 'RON', NULL, 8, 6, 11),
(6440, 22.00, 'RON', NULL, 8, 6, 12),
(6441, 24.00, 'RON', NULL, 8, 6, 20),
(6442, 29.00, 'RON', NULL, 8, 6, 55),
(6443, 39.00, 'RON', NULL, 8, 6, 56),
(6444, 42.00, 'RON', NULL, 8, 6, 57),
(6445, 47.00, 'RON', NULL, 8, 6, 58),
(6446, 51.00, 'RON', NULL, 8, 6, 59),
(6447, 52.00, 'RON', NULL, 8, 6, 60),
(6448, 57.00, 'RON', NULL, 8, 6, 61),
(6449, 62.00, 'RON', NULL, 8, 6, 62),
(6450, 67.00, 'RON', NULL, 8, 6, 63),
(6451, 72.00, 'RON', NULL, 8, 6, 64),
(6452, 77.00, 'RON', NULL, 8, 6, 65),
(6453, 87.00, 'RON', NULL, 8, 6, 66),
(6454, 92.00, 'RON', NULL, 8, 6, 67),
(6455, 97.00, 'RON', NULL, 8, 6, 68),
(6456, 102.00, 'RON', NULL, 8, 6, 69),
(6457, 107.00, 'RON', NULL, 8, 6, 70),
(6458, 107.00, 'RON', NULL, 8, 6, 71),
(6459, 111.00, 'RON', NULL, 8, 6, 72),
(6460, 112.00, 'RON', NULL, 8, 6, 73),
(6461, 117.00, 'RON', NULL, 8, 6, 74),
(6462, 117.00, 'RON', NULL, 8, 6, 75),
(6463, 122.00, 'RON', NULL, 8, 6, 76),
(6464, 127.00, 'RON', NULL, 8, 6, 77),
(6465, 132.00, 'RON', NULL, 8, 6, 78),
(6466, 132.00, 'RON', NULL, 8, 6, 79),
(6467, 140.00, 'RON', NULL, 8, 6, 80),
(6468, 4.00, 'RON', NULL, 8, 7, 8),
(6469, 7.00, 'RON', NULL, 8, 7, 4),
(6470, 8.00, 'RON', NULL, 8, 7, 9),
(6471, 10.00, 'RON', NULL, 8, 7, 5),
(6472, 14.00, 'RON', NULL, 8, 7, 24),
(6473, 15.00, 'RON', NULL, 8, 7, 3),
(6474, 16.00, 'RON', NULL, 8, 7, 23),
(6475, 17.00, 'RON', NULL, 8, 7, 22),
(6476, 17.00, 'RON', NULL, 8, 7, 21),
(6477, 18.00, 'RON', NULL, 8, 7, 10),
(6478, 20.00, 'RON', NULL, 8, 7, 11),
(6479, 21.00, 'RON', NULL, 8, 7, 12),
(6480, 23.00, 'RON', NULL, 8, 7, 20),
(6481, 28.00, 'RON', NULL, 8, 7, 55),
(6482, 38.00, 'RON', NULL, 8, 7, 56),
(6483, 41.00, 'RON', NULL, 8, 7, 57),
(6484, 46.00, 'RON', NULL, 8, 7, 58),
(6485, 50.00, 'RON', NULL, 8, 7, 59),
(6486, 51.00, 'RON', NULL, 8, 7, 60),
(6487, 56.00, 'RON', NULL, 8, 7, 61),
(6488, 61.00, 'RON', NULL, 8, 7, 62),
(6489, 66.00, 'RON', NULL, 8, 7, 63),
(6490, 71.00, 'RON', NULL, 8, 7, 64),
(6491, 76.00, 'RON', NULL, 8, 7, 65),
(6492, 86.00, 'RON', NULL, 8, 7, 66),
(6493, 91.00, 'RON', NULL, 8, 7, 67),
(6494, 96.00, 'RON', NULL, 8, 7, 68),
(6495, 101.00, 'RON', NULL, 8, 7, 69),
(6496, 106.00, 'RON', NULL, 8, 7, 70),
(6497, 106.00, 'RON', NULL, 8, 7, 71),
(6498, 110.00, 'RON', NULL, 8, 7, 72),
(6499, 111.00, 'RON', NULL, 8, 7, 73),
(6500, 116.00, 'RON', NULL, 8, 7, 74),
(6501, 116.00, 'RON', NULL, 8, 7, 75),
(6502, 121.00, 'RON', NULL, 8, 7, 76),
(6503, 126.00, 'RON', NULL, 8, 7, 77),
(6504, 131.00, 'RON', NULL, 8, 7, 78),
(6505, 131.00, 'RON', NULL, 8, 7, 79),
(6506, 140.00, 'RON', NULL, 8, 7, 80),
(6507, 6.00, 'RON', NULL, 8, 8, 4),
(6508, 7.00, 'RON', NULL, 8, 8, 9),
(6509, 9.00, 'RON', NULL, 8, 8, 5),
(6510, 13.00, 'RON', NULL, 8, 8, 24),
(6511, 14.00, 'RON', NULL, 8, 8, 3),
(6512, 15.00, 'RON', NULL, 8, 8, 23),
(6513, 16.00, 'RON', NULL, 8, 8, 22),
(6514, 16.00, 'RON', NULL, 8, 8, 21),
(6515, 17.00, 'RON', NULL, 8, 8, 10),
(6516, 19.00, 'RON', NULL, 8, 8, 11),
(6517, 20.00, 'RON', NULL, 8, 8, 12),
(6518, 22.00, 'RON', NULL, 8, 8, 20),
(6519, 27.00, 'RON', NULL, 8, 8, 55),
(6520, 37.00, 'RON', NULL, 8, 8, 56),
(6521, 40.00, 'RON', NULL, 8, 8, 57),
(6522, 45.00, 'RON', NULL, 8, 8, 58),
(6523, 49.00, 'RON', NULL, 8, 8, 59),
(6524, 50.00, 'RON', NULL, 8, 8, 60),
(6525, 55.00, 'RON', NULL, 8, 8, 61),
(6526, 60.00, 'RON', NULL, 8, 8, 62),
(6527, 65.00, 'RON', NULL, 8, 8, 63),
(6528, 70.00, 'RON', NULL, 8, 8, 64),
(6529, 75.00, 'RON', NULL, 8, 8, 65),
(6530, 85.00, 'RON', NULL, 8, 8, 66),
(6531, 90.00, 'RON', NULL, 8, 8, 67),
(6532, 95.00, 'RON', NULL, 8, 8, 68),
(6533, 100.00, 'RON', NULL, 8, 8, 69),
(6534, 105.00, 'RON', NULL, 8, 8, 70),
(6535, 105.00, 'RON', NULL, 8, 8, 71),
(6536, 109.00, 'RON', NULL, 8, 8, 72),
(6537, 110.00, 'RON', NULL, 8, 8, 73),
(6538, 115.00, 'RON', NULL, 8, 8, 74),
(6539, 115.00, 'RON', NULL, 8, 8, 75),
(6540, 120.00, 'RON', NULL, 8, 8, 76),
(6541, 125.00, 'RON', NULL, 8, 8, 77),
(6542, 130.00, 'RON', NULL, 8, 8, 78),
(6543, 130.00, 'RON', NULL, 8, 8, 79),
(6544, 140.00, 'RON', NULL, 8, 8, 80),
(6545, 5.00, 'RON', NULL, 8, 4, 9),
(6546, 6.00, 'RON', NULL, 8, 4, 5),
(6547, 12.00, 'RON', NULL, 8, 4, 24),
(6548, 13.00, 'RON', NULL, 8, 4, 3),
(6549, 14.00, 'RON', NULL, 8, 4, 23),
(6550, 15.00, 'RON', NULL, 8, 4, 22),
(6551, 15.00, 'RON', NULL, 8, 4, 21),
(6552, 16.00, 'RON', NULL, 8, 4, 10),
(6553, 18.00, 'RON', NULL, 8, 4, 11),
(6554, 19.00, 'RON', NULL, 8, 4, 12),
(6555, 21.00, 'RON', NULL, 8, 4, 20),
(6556, 26.00, 'RON', NULL, 8, 4, 55),
(6557, 36.00, 'RON', NULL, 8, 4, 56),
(6558, 39.00, 'RON', NULL, 8, 4, 57),
(6559, 44.00, 'RON', NULL, 8, 4, 58),
(6560, 48.00, 'RON', NULL, 8, 4, 59),
(6561, 49.00, 'RON', NULL, 8, 4, 60),
(6562, 54.00, 'RON', NULL, 8, 4, 61),
(6563, 59.00, 'RON', NULL, 8, 4, 62),
(6564, 64.00, 'RON', NULL, 8, 4, 63),
(6565, 69.00, 'RON', NULL, 8, 4, 64),
(6566, 74.00, 'RON', NULL, 8, 4, 65),
(6567, 84.00, 'RON', NULL, 8, 4, 66),
(6568, 89.00, 'RON', NULL, 8, 4, 67),
(6569, 94.00, 'RON', NULL, 8, 4, 68),
(6570, 99.00, 'RON', NULL, 8, 4, 69),
(6571, 104.00, 'RON', NULL, 8, 4, 70),
(6572, 104.00, 'RON', NULL, 8, 4, 71),
(6573, 108.00, 'RON', NULL, 8, 4, 72),
(6574, 109.00, 'RON', NULL, 8, 4, 73),
(6575, 114.00, 'RON', NULL, 8, 4, 74),
(6576, 114.00, 'RON', NULL, 8, 4, 75),
(6577, 119.00, 'RON', NULL, 8, 4, 76),
(6578, 124.00, 'RON', NULL, 8, 4, 77),
(6579, 130.00, 'RON', NULL, 8, 4, 78),
(6580, 129.00, 'RON', NULL, 8, 4, 79),
(6581, 140.00, 'RON', NULL, 8, 4, 80),
(6582, 5.00, 'RON', NULL, 8, 9, 5),
(6583, 10.00, 'RON', NULL, 8, 9, 24),
(6584, 11.00, 'RON', NULL, 8, 9, 3),
(6585, 12.00, 'RON', NULL, 8, 9, 23),
(6586, 13.00, 'RON', NULL, 8, 9, 22),
(6587, 14.00, 'RON', NULL, 8, 9, 21),
(6588, 15.00, 'RON', NULL, 8, 9, 10),
(6589, 17.00, 'RON', NULL, 8, 9, 11),
(6590, 18.00, 'RON', NULL, 8, 9, 12),
(6591, 20.00, 'RON', NULL, 8, 9, 20),
(6592, 25.00, 'RON', NULL, 8, 9, 55),
(6593, 35.00, 'RON', NULL, 8, 9, 56),
(6594, 38.00, 'RON', NULL, 8, 9, 57),
(6595, 43.00, 'RON', NULL, 8, 9, 58),
(6596, 47.00, 'RON', NULL, 8, 9, 59),
(6597, 48.00, 'RON', NULL, 8, 9, 60),
(6598, 53.00, 'RON', NULL, 8, 9, 61),
(6599, 58.00, 'RON', NULL, 8, 9, 62),
(6600, 63.00, 'RON', NULL, 8, 9, 63),
(6601, 68.00, 'RON', NULL, 8, 9, 64),
(6602, 73.00, 'RON', NULL, 8, 9, 65),
(6603, 83.00, 'RON', NULL, 8, 9, 66),
(6604, 88.00, 'RON', NULL, 8, 9, 67),
(6605, 93.00, 'RON', NULL, 8, 9, 68),
(6606, 98.00, 'RON', NULL, 8, 9, 69),
(6607, 103.00, 'RON', NULL, 8, 9, 70),
(6608, 103.00, 'RON', NULL, 8, 9, 71),
(6609, 107.00, 'RON', NULL, 8, 9, 72),
(6610, 108.00, 'RON', NULL, 8, 9, 73),
(6611, 113.00, 'RON', NULL, 8, 9, 74),
(6612, 113.00, 'RON', NULL, 8, 9, 75),
(6613, 118.00, 'RON', NULL, 8, 9, 76),
(6614, 123.00, 'RON', NULL, 8, 9, 77),
(6615, 130.00, 'RON', NULL, 8, 9, 78),
(6616, 128.00, 'RON', NULL, 8, 9, 79),
(6617, 140.00, 'RON', NULL, 8, 9, 80),
(6618, 7.00, 'RON', NULL, 8, 5, 24),
(6619, 10.00, 'RON', NULL, 8, 5, 3),
(6620, 11.00, 'RON', NULL, 8, 5, 23),
(6621, 12.00, 'RON', NULL, 8, 5, 22),
(6622, 13.00, 'RON', NULL, 8, 5, 21),
(6623, 14.00, 'RON', NULL, 8, 5, 10),
(6624, 16.00, 'RON', NULL, 8, 5, 11),
(6625, 17.00, 'RON', NULL, 8, 5, 12),
(6626, 18.00, 'RON', NULL, 8, 5, 20),
(6627, 23.00, 'RON', NULL, 8, 5, 55),
(6628, 33.00, 'RON', NULL, 8, 5, 56),
(6629, 36.00, 'RON', NULL, 8, 5, 57),
(6630, 41.00, 'RON', NULL, 8, 5, 58),
(6631, 45.00, 'RON', NULL, 8, 5, 59),
(6632, 46.00, 'RON', NULL, 8, 5, 60),
(6633, 51.00, 'RON', NULL, 8, 5, 61),
(6634, 56.00, 'RON', NULL, 8, 5, 62),
(6635, 61.00, 'RON', NULL, 8, 5, 63),
(6636, 66.00, 'RON', NULL, 8, 5, 64),
(6637, 71.00, 'RON', NULL, 8, 5, 65),
(6638, 81.00, 'RON', NULL, 8, 5, 66),
(6639, 86.00, 'RON', NULL, 8, 5, 67),
(6640, 91.00, 'RON', NULL, 8, 5, 68),
(6641, 96.00, 'RON', NULL, 8, 5, 69),
(6642, 101.00, 'RON', NULL, 8, 5, 70),
(6643, 102.00, 'RON', NULL, 8, 5, 71),
(6644, 106.00, 'RON', NULL, 8, 5, 72),
(6645, 107.00, 'RON', NULL, 8, 5, 73),
(6646, 112.00, 'RON', NULL, 8, 5, 74),
(6647, 112.00, 'RON', NULL, 8, 5, 75),
(6648, 117.00, 'RON', NULL, 8, 5, 76),
(6649, 122.00, 'RON', NULL, 8, 5, 77),
(6650, 130.00, 'RON', NULL, 8, 5, 78),
(6651, 127.00, 'RON', NULL, 8, 5, 79),
(6652, 140.00, 'RON', NULL, 8, 5, 80),
(6653, 4.00, 'RON', NULL, 8, 24, 3),
(6654, 5.00, 'RON', NULL, 8, 24, 23),
(6655, 9.00, 'RON', NULL, 8, 24, 22),
(6656, 10.00, 'RON', NULL, 8, 24, 21),
(6657, 11.00, 'RON', NULL, 8, 24, 10),
(6658, 12.00, 'RON', NULL, 8, 24, 11),
(6659, 14.00, 'RON', NULL, 8, 24, 12),
(6660, 16.00, 'RON', NULL, 8, 24, 20),
(6661, 21.00, 'RON', NULL, 8, 24, 55),
(6662, 31.00, 'RON', NULL, 8, 24, 56),
(6663, 34.00, 'RON', NULL, 8, 24, 57),
(6664, 39.00, 'RON', NULL, 8, 24, 58),
(6665, 43.00, 'RON', NULL, 8, 24, 59),
(6666, 44.00, 'RON', NULL, 8, 24, 60),
(6667, 49.00, 'RON', NULL, 8, 24, 61),
(6668, 54.00, 'RON', NULL, 8, 24, 62),
(6669, 59.00, 'RON', NULL, 8, 24, 63),
(6670, 64.00, 'RON', NULL, 8, 24, 64),
(6671, 69.00, 'RON', NULL, 8, 24, 65),
(6672, 79.00, 'RON', NULL, 8, 24, 66),
(6673, 84.00, 'RON', NULL, 8, 24, 67),
(6674, 89.00, 'RON', NULL, 8, 24, 68),
(6675, 94.00, 'RON', NULL, 8, 24, 69),
(6676, 99.00, 'RON', NULL, 8, 24, 70),
(6677, 100.00, 'RON', NULL, 8, 24, 71),
(6678, 104.00, 'RON', NULL, 8, 24, 72),
(6679, 105.00, 'RON', NULL, 8, 24, 73),
(6680, 110.00, 'RON', NULL, 8, 24, 74),
(6681, 110.00, 'RON', NULL, 8, 24, 75),
(6682, 115.00, 'RON', NULL, 8, 24, 76),
(6683, 120.00, 'RON', NULL, 8, 24, 77),
(6684, 125.00, 'RON', NULL, 8, 24, 78),
(6685, 125.00, 'RON', NULL, 8, 24, 79),
(6686, 130.00, 'RON', NULL, 8, 24, 80),
(6687, 4.00, 'RON', NULL, 8, 3, 23),
(6688, 7.00, 'RON', NULL, 8, 3, 22),
(6689, 8.00, 'RON', NULL, 8, 3, 21),
(6690, 10.00, 'RON', NULL, 8, 3, 10),
(6691, 10.00, 'RON', NULL, 8, 3, 11),
(6692, 12.00, 'RON', NULL, 8, 3, 12),
(6693, 15.00, 'RON', NULL, 8, 3, 20),
(6694, 20.00, 'RON', NULL, 8, 3, 55),
(6695, 30.00, 'RON', NULL, 8, 3, 56),
(6696, 33.00, 'RON', NULL, 8, 3, 57),
(6697, 38.00, 'RON', NULL, 8, 3, 58),
(6698, 42.00, 'RON', NULL, 8, 3, 59),
(6699, 43.00, 'RON', NULL, 8, 3, 60),
(6700, 48.00, 'RON', NULL, 8, 3, 61),
(6701, 50.00, 'RON', NULL, 8, 3, 62),
(6702, 58.00, 'RON', NULL, 8, 3, 63),
(6703, 63.00, 'RON', NULL, 8, 3, 64),
(6704, 68.00, 'RON', NULL, 8, 3, 65),
(6705, 78.00, 'RON', NULL, 8, 3, 66),
(6706, 83.00, 'RON', NULL, 8, 3, 67),
(6707, 88.00, 'RON', NULL, 8, 3, 68),
(6708, 93.00, 'RON', NULL, 8, 3, 69),
(6709, 98.00, 'RON', NULL, 8, 3, 70),
(6710, 99.00, 'RON', NULL, 8, 3, 71),
(6711, 103.00, 'RON', NULL, 8, 3, 72),
(6712, 104.00, 'RON', NULL, 8, 3, 73),
(6713, 109.00, 'RON', NULL, 8, 3, 74),
(6714, 109.00, 'RON', NULL, 8, 3, 75),
(6715, 114.00, 'RON', NULL, 8, 3, 76),
(6716, 119.00, 'RON', NULL, 8, 3, 77),
(6717, 124.00, 'RON', NULL, 8, 3, 78),
(6718, 124.00, 'RON', NULL, 8, 3, 79),
(6719, 130.00, 'RON', NULL, 8, 3, 80),
(6720, 5.00, 'RON', NULL, 8, 23, 22),
(6721, 6.00, 'RON', NULL, 8, 23, 21),
(6722, 9.00, 'RON', NULL, 8, 23, 10),
(6723, 9.00, 'RON', NULL, 8, 23, 11),
(6724, 11.00, 'RON', NULL, 8, 23, 12),
(6725, 14.00, 'RON', NULL, 8, 23, 20),
(6726, 19.00, 'RON', NULL, 8, 23, 55),
(6727, 29.00, 'RON', NULL, 8, 23, 56),
(6728, 31.00, 'RON', NULL, 8, 23, 57),
(6729, 36.00, 'RON', NULL, 8, 23, 58),
(6730, 40.00, 'RON', NULL, 8, 23, 59),
(6731, 41.00, 'RON', NULL, 8, 23, 60),
(6732, 46.00, 'RON', NULL, 8, 23, 61),
(6733, 51.00, 'RON', NULL, 8, 23, 62),
(6734, 56.00, 'RON', NULL, 8, 23, 63),
(6735, 61.00, 'RON', NULL, 8, 23, 64),
(6736, 66.00, 'RON', NULL, 8, 23, 65),
(6737, 76.00, 'RON', NULL, 8, 23, 66),
(6738, 81.00, 'RON', NULL, 8, 23, 67),
(6739, 86.00, 'RON', NULL, 8, 23, 68),
(6740, 91.00, 'RON', NULL, 8, 23, 69),
(6741, 96.00, 'RON', NULL, 8, 23, 70),
(6742, 97.00, 'RON', NULL, 8, 23, 71),
(6743, 101.00, 'RON', NULL, 8, 23, 72),
(6744, 102.00, 'RON', NULL, 8, 23, 73),
(6745, 107.00, 'RON', NULL, 8, 23, 74),
(6746, 107.00, 'RON', NULL, 8, 23, 75),
(6747, 113.00, 'RON', NULL, 8, 23, 76),
(6748, 118.00, 'RON', NULL, 8, 23, 77),
(6749, 123.00, 'RON', NULL, 8, 23, 78),
(6750, 123.00, 'RON', NULL, 8, 23, 79),
(6751, 125.00, 'RON', NULL, 8, 23, 80),
(6752, 5.00, 'RON', NULL, 8, 22, 21),
(6753, 6.00, 'RON', NULL, 8, 22, 10),
(6754, 7.00, 'RON', NULL, 8, 22, 11),
(6755, 9.00, 'RON', NULL, 8, 22, 12),
(6756, 12.00, 'RON', NULL, 8, 22, 20),
(6757, 17.00, 'RON', NULL, 8, 22, 55),
(6758, 27.00, 'RON', NULL, 8, 22, 56),
(6759, 30.00, 'RON', NULL, 8, 22, 57),
(6760, 35.00, 'RON', NULL, 8, 22, 58),
(6761, 39.00, 'RON', NULL, 8, 22, 59),
(6762, 40.00, 'RON', NULL, 8, 22, 60),
(6763, 45.00, 'RON', NULL, 8, 22, 61),
(6764, 50.00, 'RON', NULL, 8, 22, 62),
(6765, 55.00, 'RON', NULL, 8, 22, 63),
(6766, 60.00, 'RON', NULL, 8, 22, 64),
(6767, 65.00, 'RON', NULL, 8, 22, 65),
(6768, 75.00, 'RON', NULL, 8, 22, 66),
(6769, 80.00, 'RON', NULL, 8, 22, 67),
(6770, 85.00, 'RON', NULL, 8, 22, 68),
(6771, 90.00, 'RON', NULL, 8, 22, 69),
(6772, 95.00, 'RON', NULL, 8, 22, 70),
(6773, 96.00, 'RON', NULL, 8, 22, 71),
(6774, 100.00, 'RON', NULL, 8, 22, 72),
(6775, 101.00, 'RON', NULL, 8, 22, 73),
(6776, 106.00, 'RON', NULL, 8, 22, 74),
(6777, 106.00, 'RON', NULL, 8, 22, 75),
(6778, 111.00, 'RON', NULL, 8, 22, 76),
(6779, 116.00, 'RON', NULL, 8, 22, 77),
(6780, 121.00, 'RON', NULL, 8, 22, 78),
(6781, 121.00, 'RON', NULL, 8, 22, 79),
(6782, 125.00, 'RON', NULL, 8, 22, 80),
(6783, 5.00, 'RON', NULL, 8, 21, 10),
(6784, 6.00, 'RON', NULL, 8, 21, 11),
(6785, 9.00, 'RON', NULL, 8, 21, 12),
(6786, 11.00, 'RON', NULL, 8, 21, 20),
(6787, 16.00, 'RON', NULL, 8, 21, 55),
(6788, 26.00, 'RON', NULL, 8, 21, 56),
(6789, 29.00, 'RON', NULL, 8, 21, 57),
(6790, 34.00, 'RON', NULL, 8, 21, 58),
(6791, 38.00, 'RON', NULL, 8, 21, 59),
(6792, 39.00, 'RON', NULL, 8, 21, 60),
(6793, 44.00, 'RON', NULL, 8, 21, 61),
(6794, 49.00, 'RON', NULL, 8, 21, 62),
(6795, 54.00, 'RON', NULL, 8, 21, 63),
(6796, 59.00, 'RON', NULL, 8, 21, 64),
(6797, 64.00, 'RON', NULL, 8, 21, 65),
(6798, 74.00, 'RON', NULL, 8, 21, 66),
(6799, 79.00, 'RON', NULL, 8, 21, 67),
(6800, 84.00, 'RON', NULL, 8, 21, 68),
(6801, 89.00, 'RON', NULL, 8, 21, 69),
(6802, 94.00, 'RON', NULL, 8, 21, 70),
(6803, 95.00, 'RON', NULL, 8, 21, 71),
(6804, 99.00, 'RON', NULL, 8, 21, 72),
(6805, 100.00, 'RON', NULL, 8, 21, 73),
(6806, 105.00, 'RON', NULL, 8, 21, 74),
(6807, 105.00, 'RON', NULL, 8, 21, 75),
(6808, 110.00, 'RON', NULL, 8, 21, 76),
(6809, 115.00, 'RON', NULL, 8, 21, 77),
(6810, 120.00, 'RON', NULL, 8, 21, 78),
(6811, 120.00, 'RON', NULL, 8, 21, 79),
(6812, 125.00, 'RON', NULL, 8, 21, 80);

-- --------------------------------------------------------

--
-- Table structure for table `pricing_categories`
--

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

CREATE TABLE `promo_code_hours` (
  `promo_code_id` int(11) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `promo_code_routes`
--

CREATE TABLE `promo_code_routes` (
  `promo_code_id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `promo_code_schedules`
--

CREATE TABLE `promo_code_schedules` (
  `promo_code_id` int(11) NOT NULL,
  `route_schedule_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `promo_code_usages`
--

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

CREATE TABLE `promo_code_weekdays` (
  `promo_code_id` int(11) NOT NULL,
  `weekday` tinyint(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `public_users`
--

CREATE TABLE `public_users` (
  `id` bigint(20) UNSIGNED NOT NULL,
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
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `public_users`
--

INSERT INTO `public_users` (`id`, `email`, `email_normalized`, `password_hash`, `name`, `phone`, `phone_normalized`, `email_verified_at`, `phone_verified_at`, `google_sub`, `apple_sub`, `last_login_at`, `created_at`, `updated_at`) VALUES
(1, 'madafaka_mw@yahoo.com', 'madafaka_mw@yahoo.com', '$2a$12$THGT3qTekOnRxx20OfrZPOwg4xJjl0d5dosIIsDfLmjwjy2RmDwV2', 'Rosu Iulian', '+40743171315', '40743171315', NULL, NULL, NULL, NULL, '2025-11-10 14:44:21', '2025-11-10 14:44:21', '2025-11-10 14:44:21');

-- --------------------------------------------------------

--
-- Table structure for table `public_user_phone_links`
--

CREATE TABLE `public_user_phone_links` (
  `id` bigint(20) UNSIGNED NOT NULL,
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
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `public_user_sessions`
--

CREATE TABLE `public_user_sessions` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `token_hash` char(64) NOT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `ip_address` varchar(64) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `rotated_from` char(64) DEFAULT NULL,
  `persistent` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `public_user_sessions`
--

INSERT INTO `public_user_sessions` (`id`, `user_id`, `token_hash`, `user_agent`, `ip_address`, `created_at`, `expires_at`, `revoked_at`, `rotated_from`, `persistent`) VALUES
(1, 1, '875c24f93e278a21f9b8203c20fbf44f804df054967d3fcffe8cb45f7dbd304c', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', '82.77.242.74', '2025-11-10 14:44:21', '2025-12-10 14:44:21', NULL, NULL, 0);

-- --------------------------------------------------------

--
-- Table structure for table `reservations`
--

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
(19, 730, 27, 8, '2025-11-07 08:44:55', 'active', NULL, 1, 1, 2, 0),
(20, 730, 28, 7, '2025-11-07 09:12:23', 'active', NULL, 1, 1, 2, 0),
(21, 730, 29, 7, '2025-11-07 09:22:08', 'active', NULL, 1, 1, 2, 0),
(22, 730, 30, 9, '2025-11-07 09:26:53', 'active', NULL, 1, 1, 2, 0),
(23, 730, 31, 7, '2025-11-07 09:36:41', 'active', NULL, 1, 1, 2, 0),
(24, 730, 32, 7, '2025-11-07 09:57:29', 'active', NULL, 1, 1, 2, 0),
(25, 731, 3, 7, '2025-11-07 09:59:44', 'active', NULL, 1, 1, 2, 0),
(26, 731, 4, 10, '2025-11-07 10:00:04', 'active', NULL, 1, 1, 2, 0),
(27, 731, 6, 8, '2025-11-07 10:31:24', 'active', NULL, 1, 1, 2, 0),
(28, 730, 33, 7, '2025-11-07 14:36:37', 'active', NULL, 1, 1, 2, 0),
(29, 731, 5, 7, '2025-11-07 14:37:20', 'active', NULL, 1, 1, 2, 0),
(30, 731, 7, 7, '2025-11-07 14:37:20', 'active', NULL, 1, 1, 2, 0),
(31, 731, 8, 7, '2025-11-07 14:37:20', 'active', NULL, 1, 1, 2, 0),
(32, 731, 11, 7, '2025-11-07 14:37:20', 'active', NULL, 1, 1, 2, 0);

-- --------------------------------------------------------

--
-- Table structure for table `reservations_backup`
--

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
(19, 0.10, 3, 1, 'agent', 1, '2025-11-07 10:44:55', '2025-11-07 10:44:55'),
(20, 0.10, 3, 1, 'agent', 1, '2025-11-07 11:12:23', '2025-11-07 11:12:23'),
(21, 0.10, 3, 1, 'agent', 1, '2025-11-07 11:22:08', '2025-11-07 11:22:08'),
(22, 0.10, 3, 1, 'agent', 1, '2025-11-07 11:26:53', '2025-11-07 11:26:53'),
(23, 0.10, 3, 1, 'agent', 1, '2025-11-07 11:36:41', '2025-11-07 11:36:41'),
(24, 0.10, 3, 1, 'agent', 1, '2025-11-07 11:57:29', '2025-11-07 11:57:29'),
(25, 0.10, 3, 1, 'agent', 1, '2025-11-07 11:59:44', '2025-11-07 11:59:44'),
(26, 0.10, 3, 1, 'agent', 1, '2025-11-07 12:00:04', '2025-11-07 12:00:04'),
(27, 0.10, 3, 1, 'agent', 1, '2025-11-07 12:31:24', '2025-11-07 12:31:24'),
(28, 0.10, 3, 1, 'agent', 1, '2025-11-07 16:36:37', '2025-11-07 16:36:37'),
(29, 0.10, 3, 1, 'agent', 1, '2025-11-07 16:37:20', '2025-11-07 16:37:20'),
(30, 0.10, 3, 1, 'agent', 1, '2025-11-07 16:37:20', '2025-11-07 16:37:20'),
(31, 0.10, 3, 1, 'agent', 1, '2025-11-07 16:37:20', '2025-11-07 16:37:20'),
(32, 0.10, 3, 1, 'agent', 1, '2025-11-07 16:37:20', '2025-11-07 16:37:20');

-- --------------------------------------------------------

--
-- Table structure for table `routes`
--

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
(1, 'Botoșani - Iași', NULL, 1, 1, 1),
(3, 'Rădăuți - Iași', NULL, 1, 1, 1),
(4, 'Dorohoi - Iași', NULL, 1, 1, 1),
(5, 'Botoșani - Brașov', NULL, 1, 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `route_schedules`
--

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
(3, 1, '07:00:00', 1, 'tur'),
(15, 1, '07:00:00', 2, 'retur'),
(5, 1, '09:00:00', 1, 'tur'),
(16, 1, '10:00:00', 1, 'retur'),
(6, 1, '11:30:00', 2, 'tur'),
(24, 1, '12:00:00', 1, 'retur'),
(19, 1, '13:00:00', 2, 'retur'),
(11, 1, '13:30:00', 1, 'tur'),
(20, 1, '14:00:00', 1, 'retur'),
(21, 1, '15:00:00', 2, 'retur'),
(12, 1, '15:30:00', 1, 'tur'),
(13, 1, '17:00:00', 2, 'tur'),
(22, 1, '17:00:00', 1, 'retur'),
(14, 1, '19:00:00', 2, 'tur'),
(23, 1, '19:00:00', 1, 'retur'),
(9, 3, '08:00:00', 2, 'tur'),
(10, 3, '16:00:00', 2, 'retur'),
(25, 4, '07:00:00', 2, 'tur'),
(26, 4, '11:00:00', 2, 'retur'),
(27, 5, '08:00:00', 2, 'tur'),
(28, 5, '16:00:00', 2, 'retur');

-- --------------------------------------------------------

--
-- Table structure for table `route_schedule_discounts`
--

CREATE TABLE `route_schedule_discounts` (
  `discount_type_id` int(11) NOT NULL,
  `route_schedule_id` int(11) NOT NULL,
  `visible_agents` tinyint(1) NOT NULL DEFAULT 1,
  `visible_online` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `route_schedule_discounts`
--

INSERT INTO `route_schedule_discounts` (`discount_type_id`, `route_schedule_id`, `visible_agents`, `visible_online`) VALUES
(0, 1, 1, 1),
(0, 3, 1, 1),
(0, 5, 1, 0),
(0, 6, 1, 0),
(0, 9, 1, 0),
(0, 10, 1, 0),
(0, 11, 1, 0),
(0, 12, 1, 0),
(0, 13, 1, 0),
(0, 14, 1, 0),
(0, 15, 1, 0),
(0, 16, 1, 0),
(0, 19, 1, 0),
(0, 20, 1, 0),
(0, 21, 1, 0),
(0, 22, 1, 0),
(0, 23, 1, 0),
(0, 24, 1, 0),
(0, 25, 1, 0),
(0, 26, 1, 0),
(1, 1, 1, 1),
(1, 3, 1, 1),
(1, 5, 1, 1),
(1, 6, 1, 1),
(1, 9, 1, 1),
(1, 10, 1, 1),
(1, 11, 1, 1),
(1, 12, 1, 1),
(1, 13, 1, 1),
(1, 14, 1, 1),
(1, 15, 1, 1),
(1, 16, 1, 1),
(1, 19, 1, 1),
(1, 20, 1, 1),
(1, 21, 1, 1),
(1, 22, 1, 1),
(1, 23, 1, 1),
(1, 24, 1, 1),
(1, 25, 1, 1),
(1, 26, 1, 1),
(2, 1, 1, 0),
(2, 3, 1, 0),
(2, 5, 1, 0),
(2, 6, 1, 0),
(2, 9, 1, 0),
(2, 10, 1, 0),
(2, 11, 1, 0),
(2, 12, 1, 0),
(2, 13, 1, 0),
(2, 14, 1, 0),
(2, 15, 1, 0),
(2, 16, 1, 0),
(2, 19, 1, 0),
(2, 20, 1, 0),
(2, 21, 1, 0),
(2, 22, 1, 0),
(2, 23, 1, 0),
(2, 24, 1, 0),
(2, 25, 1, 0),
(2, 26, 1, 0),
(4, 1, 1, 1),
(4, 3, 1, 1),
(4, 5, 1, 1),
(4, 6, 1, 1),
(4, 9, 1, 1),
(4, 10, 1, 1),
(4, 11, 1, 1),
(4, 12, 1, 1),
(4, 13, 1, 1),
(4, 14, 1, 1),
(4, 15, 1, 1),
(4, 16, 1, 1),
(4, 19, 1, 1),
(4, 20, 1, 1),
(4, 21, 1, 1),
(4, 22, 1, 1),
(4, 23, 1, 1),
(4, 24, 1, 1),
(4, 25, 1, 1),
(4, 26, 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `route_schedule_pricing_categories`
--

CREATE TABLE `route_schedule_pricing_categories` (
  `route_schedule_id` int(11) NOT NULL,
  `pricing_category_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `route_schedule_pricing_categories`
--

INSERT INTO `route_schedule_pricing_categories` (`route_schedule_id`, `pricing_category_id`) VALUES
(1, 1),
(3, 1),
(5, 1),
(6, 1),
(9, 1),
(10, 1),
(11, 1),
(12, 1),
(13, 1),
(14, 1),
(15, 1),
(16, 1),
(19, 1),
(20, 1),
(21, 1),
(22, 1),
(23, 1),
(24, 1),
(25, 1),
(26, 1);

-- --------------------------------------------------------

--
-- Table structure for table `route_stations`
--

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
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
  `public_note_tur` varchar(255) DEFAULT NULL,
  `public_note_retur` varchar(255) DEFAULT NULL,
  `public_latitude_tur` decimal(10,7) DEFAULT NULL,
  `public_longitude_tur` decimal(10,7) DEFAULT NULL,
  `public_latitude_retur` decimal(10,7) DEFAULT NULL,
  `public_longitude_retur` decimal(10,7) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `route_stations`
--

INSERT INTO `route_stations` (`id`, `route_id`, `station_id`, `sequence`, `distance_from_previous_km`, `travel_time_from_previous_minutes`, `dwell_time_minutes`, `geofence_type`, `geofence_radius_m`, `geofence_polygon`, `created_at`, `updated_at`, `public_note_tur`, `public_note_retur`, `public_latitude_tur`, `public_longitude_tur`, `public_latitude_retur`, `public_longitude_retur`) VALUES
(17, 3, 45, 1, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(18, 3, 44, 2, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(19, 3, 43, 3, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(20, 3, 42, 4, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(21, 3, 41, 5, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(22, 3, 40, 6, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(23, 3, 39, 7, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(24, 3, 38, 8, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(25, 3, 37, 9, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(26, 3, 36, 10, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(27, 3, 35, 11, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(28, 3, 34, 12, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(29, 3, 33, 13, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(30, 3, 32, 14, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(31, 3, 31, 15, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(32, 3, 30, 16, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(33, 3, 1, 17, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(34, 3, 29, 18, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(35, 3, 28, 19, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(36, 3, 27, 20, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(37, 3, 26, 21, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(38, 3, 25, 22, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(39, 3, 6, 23, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(40, 3, 7, 24, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(41, 3, 8, 25, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(42, 3, 4, 26, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(43, 3, 9, 27, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(44, 3, 5, 28, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(45, 3, 24, 29, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(46, 3, 3, 30, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(47, 3, 23, 31, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(48, 3, 22, 32, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(49, 3, 21, 33, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(50, 3, 10, 34, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(51, 3, 11, 35, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(52, 3, 12, 36, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(53, 3, 20, 37, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(54, 3, 19, 38, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(55, 3, 18, 39, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(56, 3, 17, 40, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(57, 3, 16, 41, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(58, 3, 15, 42, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(59, 3, 14, 43, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(60, 3, 13, 44, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(61, 3, 2, 45, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 15:07:00', '2025-11-10 15:07:00', NULL, NULL, NULL, NULL, NULL, NULL),
(64, 4, 46, 1, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(65, 4, 47, 2, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(66, 4, 48, 3, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(67, 4, 49, 4, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(68, 4, 50, 5, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(69, 4, 51, 6, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(70, 4, 52, 7, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(71, 4, 54, 8, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(72, 4, 53, 9, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(73, 4, 31, 10, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(74, 4, 30, 11, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(75, 4, 1, 12, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(76, 4, 29, 13, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(77, 4, 28, 14, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(78, 4, 27, 15, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(79, 4, 26, 16, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(80, 4, 25, 17, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(81, 4, 6, 18, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(82, 4, 7, 19, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(83, 4, 8, 20, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(84, 4, 4, 21, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(85, 4, 9, 22, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(86, 4, 5, 23, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(87, 4, 24, 24, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(88, 4, 3, 25, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(89, 4, 23, 26, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(90, 4, 22, 27, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(91, 4, 21, 28, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(92, 4, 10, 29, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(93, 4, 11, 30, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(94, 4, 12, 31, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(95, 4, 20, 32, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(96, 4, 19, 33, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(97, 4, 18, 34, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(98, 4, 17, 35, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(99, 4, 16, 36, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(100, 4, 15, 37, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(101, 4, 14, 38, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(102, 4, 13, 39, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(103, 4, 2, 40, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-10 16:03:40', '2025-11-10 16:03:40', NULL, NULL, NULL, NULL, NULL, NULL),
(104, 1, 1, 1, 70.00, 60, 0, 'circle', 200.00, NULL, '2025-11-11 09:20:17', '2025-11-11 09:20:17', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(105, 1, 3, 2, NULL, 50, 0, 'circle', 200.00, NULL, '2025-11-11 09:20:17', '2025-11-11 09:20:17', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(106, 1, 2, 3, NULL, NULL, 0, 'circle', 200.00, NULL, '2025-11-11 09:20:17', '2025-11-11 09:20:17', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(154, 5, 1, 1, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(155, 5, 29, 2, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(156, 5, 28, 3, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(157, 5, 27, 4, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(158, 5, 26, 5, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(159, 5, 25, 6, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(160, 5, 6, 7, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(161, 5, 7, 8, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(162, 5, 8, 9, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(163, 5, 4, 10, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(164, 5, 9, 11, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(165, 5, 5, 12, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(166, 5, 24, 13, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(167, 5, 3, 14, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, NULL, NULL, NULL, NULL),
(168, 5, 23, 15, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(169, 5, 22, 16, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(170, 5, 21, 17, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(171, 5, 10, 18, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(172, 5, 11, 19, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(173, 5, 12, 20, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(174, 5, 20, 21, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(175, 5, 55, 22, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(176, 5, 56, 23, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(177, 5, 57, 24, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(178, 5, 58, 25, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(179, 5, 59, 26, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(180, 5, 60, 27, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(181, 5, 61, 28, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(182, 5, 62, 29, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(183, 5, 63, 30, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(184, 5, 64, 31, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(185, 5, 65, 32, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(186, 5, 66, 33, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(187, 5, 67, 34, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(188, 5, 68, 35, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(189, 5, 69, 36, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(190, 5, 70, 37, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(191, 5, 71, 38, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(192, 5, 72, 39, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(193, 5, 73, 40, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(194, 5, 74, 41, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(195, 5, 75, 42, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(196, 5, 76, 43, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(197, 5, 77, 44, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(198, 5, 78, 45, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(199, 5, 79, 46, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000),
(200, 5, 80, 47, 0.00, 0, 0, 'circle', 200.00, NULL, '2025-11-11 10:55:54', '2025-11-11 10:55:54', NULL, NULL, 0.0000000, 0.0000000, 0.0000000, 0.0000000);

-- --------------------------------------------------------

--
-- Table structure for table `schedule_exceptions`
--

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
(2, 1, NULL, NULL, 0, 4, 1, 'Ghid', 'guide', NULL),
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
(23, 2, NULL, NULL, 0, 1, 1, 'Șofer', 'driver', NULL),
(24, 2, NULL, NULL, 0, 4, 1, 'Ghid', 'guide', NULL),
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
(43, 2, NULL, NULL, 6, 4, 1, '19', 'normal', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `seat_locks`
--

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
(15, 1, '007ffe6c6667e234d437e29d21aab73b7607e6b34df1b528d0adf8ff81a24b9c', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', '82.77.242.74', '2025-11-07 09:54:10', '2025-12-07 09:54:10', NULL, NULL),
(16, 1, '93703c5bc4a3c0de36099602e61d9a95869e9d5dc25470a1aaeaafd32c377b92', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', '82.77.242.74', '2025-11-07 11:49:31', '2025-12-07 11:49:31', NULL, NULL),
(17, 1, '88d31ae4240ec73791eaa81839457539bfce9ccdcca38681bc67c195911beac7', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', '82.77.242.74', '2025-11-10 12:09:04', '2025-12-10 12:09:04', '2025-11-10 12:59:57', NULL),
(18, 1, 'fd32512219d5ccf786d596b1e589f4bcf420d9b80277a51d1054fa061f2e3a11', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', '82.77.242.74', '2025-11-10 13:00:30', '2025-12-10 13:00:30', NULL, NULL),
(19, 4, 'ce43d61d820a6c5d36955e317322e5cdd6cb7c7a1d46c14dc739eaab2205f8e6', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/136.0.0.0 Mobile Safari/537.36', '82.77.242.74', '2025-11-10 14:31:08', '2025-12-10 14:31:08', NULL, NULL),
(20, 1, '0d90deac4d25516e1e0e05d3763f0eae413f0501671569b17d7acb4be0f8e157', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', '82.77.242.74', '2025-11-11 08:42:42', '2025-12-11 08:42:42', NULL, NULL),
(21, 1, '9a10f3b15ba3ff8b71b7ad1bff8c749493df9aadc1de57dd9c71eb7047325e3d', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', '82.77.242.74', '2025-11-11 08:42:42', '2025-12-11 08:42:42', NULL, NULL),
(22, 4, '2cee8bc8de8fe29ecf6ee7150f1ccef382990adf41684f4b150332a0ec42b9c6', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36', '82.77.242.74', '2025-11-11 10:49:58', '2025-12-11 10:49:58', NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `stations`
--

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
(3, 'Hârlău', 'Hârlău', 'Iași', 0.00000000, 0.00000000, '2025-10-31 22:06:26', '2025-11-10 15:32:54'),
(4, 'Flămânzi', 'Flămânzi', 'Botoșani', 47.56078292, 26.89753469, '2025-11-10 14:17:46', '2025-11-10 14:17:46'),
(5, 'Rădeni', 'Rădeni', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:18:05', '2025-11-10 15:32:42'),
(6, 'Buda', 'Buda', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:18:19', '2025-11-10 14:18:19'),
(7, 'Copălău', 'Copălău', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:18:35', '2025-11-10 14:18:35'),
(8, 'Cotu', 'Cotu', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:19:13', '2025-11-10 14:19:13'),
(9, 'Frumușica', 'Frumușica', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:19:33', '2025-11-10 14:19:33'),
(10, 'Cotnari', 'Cotnari', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:19:51', '2025-11-10 14:19:51'),
(11, 'Balș', 'Balș', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:20:04', '2025-11-10 14:20:04'),
(12, 'Boureni', 'Boureni', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:20:14', '2025-11-10 14:20:14'),
(13, 'Lețcani', 'Lețcani', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:24:29', '2025-11-10 14:24:29'),
(14, 'Podu Iloaiei', 'Podu Iloaiei', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:24:53', '2025-11-10 14:24:53'),
(15, 'Budăi', 'Budăi', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:25:06', '2025-11-10 14:25:06'),
(16, 'Sârca', 'Sârca', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:25:27', '2025-11-10 14:25:27'),
(17, 'Mădârjești', 'Mădârjești', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:25:41', '2025-11-10 14:25:41'),
(18, 'Bălțați', 'Bălțați', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:26:02', '2025-11-10 14:26:02'),
(19, 'Războieni', 'Războieni', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:26:17', '2025-11-10 14:26:17'),
(20, 'Târgu Frumos', 'Târgu Frumos', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:26:37', '2025-11-10 14:26:37'),
(21, 'Zlodica', 'Zlodica', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:27:01', '2025-11-10 14:27:01'),
(22, 'Ceplenița', 'Ceplenița', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:27:14', '2025-11-10 14:27:14'),
(23, 'Scobinți', 'Scobinți', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:27:31', '2025-11-10 14:27:31'),
(24, 'Maxut', 'Maxut', 'Iași', 0.00000000, 0.00000000, '2025-11-10 14:27:40', '2025-11-10 14:27:40'),
(25, 'Draxini', 'Draxini', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:27:59', '2025-11-10 14:27:59'),
(26, 'Zosin', 'Zosin', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:28:13', '2025-11-10 14:28:13'),
(27, 'Buzeni', 'Buzeni', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:29:31', '2025-11-10 14:29:31'),
(28, 'Cristești', 'Cristești', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:29:53', '2025-11-10 14:29:53'),
(29, 'Zăicești', 'Zăicești', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:30:10', '2025-11-10 14:30:10'),
(30, 'Cătămărăști', 'Cătămărăști', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:30:27', '2025-11-10 14:30:27'),
(31, 'Cucorăni', 'Cucorăni', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:30:44', '2025-11-10 14:30:44'),
(32, 'Călinești', 'Călinești', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:31:01', '2025-11-10 14:31:01'),
(33, 'Bucecea', 'Bucecea', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:31:17', '2025-11-10 14:31:17'),
(34, 'Ionășeni', 'Ionășeni', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:31:42', '2025-11-10 14:31:42'),
(35, 'Vârfu Câmpului', 'Vârfu Câmpului', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:31:58', '2025-11-10 14:31:58'),
(36, 'Lunca - Maghera', 'Lunca - Maghera', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:32:19', '2025-11-10 14:32:19'),
(37, 'Talpa - Călinești', 'Talpa - Călinești', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:32:33', '2025-11-10 14:32:33'),
(38, 'Cândești', 'Cândești', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:32:53', '2025-11-10 14:32:53'),
(39, 'Pârâu Negru', 'Pârâu Negru', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:33:07', '2025-11-10 14:33:07'),
(40, 'Mihăileni', 'Mihăileni', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:33:21', '2025-11-10 14:33:21'),
(41, 'Siret', 'Siret', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:33:32', '2025-11-10 14:33:32'),
(42, 'Negostina', 'Negostina', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:38:00', '2025-11-10 14:38:00'),
(43, 'Bălcăuți', 'Bălcăuți', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:38:15', '2025-11-10 14:38:15'),
(44, 'Dornești', 'Dornești', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:38:30', '2025-11-10 14:38:30'),
(45, 'Rădăuți', 'Rădăuți', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 14:38:41', '2025-11-10 14:38:41'),
(46, 'Dorohoi', 'Dorohoi', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 15:47:55', '2025-11-10 15:47:55'),
(47, 'Dealu Mare', 'Dealu Mare', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 15:57:56', '2025-11-10 15:57:56'),
(48, 'Săucenița', 'Săucenița', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 15:58:12', '2025-11-10 15:58:12'),
(49, 'Văculești', 'Văculești', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 15:58:28', '2025-11-10 15:58:28'),
(50, 'Brăești - Poiana', 'Brăești - Poiana', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 15:58:44', '2025-11-10 15:58:44'),
(51, 'Mitoc - Poiana', 'Mitoc - Poiana', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 15:59:02', '2025-11-10 15:59:02'),
(52, 'Leorda', 'Leorda', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 15:59:13', '2025-11-10 15:59:13'),
(53, 'Cervicești', 'Cervicești', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 15:59:29', '2025-11-10 15:59:29'),
(54, 'Leorda Blocuri', 'Leorda', 'Botoșani', 0.00000000, 0.00000000, '2025-11-10 15:59:43', '2025-11-10 15:59:43'),
(55, 'Miclăușeni', 'Strunga', 'Iași', 0.00000000, 0.00000000, '2025-11-11 09:01:30', '2025-11-11 09:02:21'),
(56, 'Castelul de Apă', 'Traian', 'Iași', 0.00000000, 0.00000000, '2025-11-11 09:02:13', '2025-11-11 09:02:13'),
(57, 'Roman', 'Roman', 'Neamț', 0.00000000, 0.00000000, '2025-11-11 09:02:37', '2025-11-11 09:02:37'),
(58, 'Horia', 'Horia', 'Neamț', 0.00000000, 0.00000000, '2025-11-11 09:03:05', '2025-11-11 09:03:05'),
(59, 'Secuienii Noi', 'Secuienii Noi', 'Neamț', 0.00000000, 0.00000000, '2025-11-11 09:03:22', '2025-11-11 09:03:22'),
(60, 'Hârlești - Onișcani', '', 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:03:47', '2025-11-11 09:22:50'),
(61, 'Dumbrava - Filipești', '', 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:04:54', '2025-11-11 09:20:01'),
(62, 'Bacău', 'Bacău', 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:05:23', '2025-11-11 09:05:23'),
(63, 'Bârzulești - Sănduleni', '', 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:05:46', '2025-11-11 09:45:47'),
(64, 'Orășa - Livezi - Bălăneasa', '', 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:10:34', '2025-11-11 09:21:59'),
(65, 'Helegiu - Brătila', NULL, 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:46:46', '2025-11-11 09:46:46'),
(66, 'Onești', 'Onești', 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:46:59', '2025-11-11 09:46:59'),
(67, 'Filipești', 'Filipești', 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:47:16', '2025-11-11 09:47:16'),
(68, 'Ferestrău - Oituz', 'Oituz', 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:48:12', '2025-11-11 09:48:12'),
(69, 'Hârja - Poiana Sărată', NULL, 'Bacău', 0.00000000, 0.00000000, '2025-11-11 09:48:36', '2025-11-11 09:48:36'),
(70, 'Pasul Oituz', 'Oituz', 'Covasna', 0.00000000, 0.00000000, '2025-11-11 09:48:51', '2025-11-11 09:48:51'),
(71, 'Brețcu - Lemnia', NULL, 'Covasna', 0.00000000, 0.00000000, '2025-11-11 09:49:17', '2025-11-11 09:49:17'),
(72, 'Lunga - Săsăuși - Tinoasa', NULL, 'Covasna', 0.00000000, 0.00000000, '2025-11-11 09:54:02', '2025-11-11 09:54:02'),
(73, 'Târgu Secuiesc', 'Târgu Secuiesc', 'Covasna', 0.00000000, 0.00000000, '2025-11-11 09:54:17', '2025-11-11 09:54:17'),
(74, 'Cernat', 'Cernat', 'Covasna', 0.00000000, 0.00000000, '2025-11-11 09:54:31', '2025-11-11 09:54:31'),
(75, 'Moacșa - Eresteghin', NULL, 'Covasna', 0.00000000, 0.00000000, '2025-11-11 09:55:05', '2025-11-11 09:55:05'),
(76, 'Reci', 'Reci', 'Covasna', 0.00000000, 0.00000000, '2025-11-11 09:55:32', '2025-11-11 09:55:32'),
(77, 'Sântionluca - Ozun', NULL, 'Covasna', 0.00000000, 0.00000000, '2025-11-11 09:56:00', '2025-11-11 09:56:00'),
(78, 'Chichiș - Lunca Câlnicului', NULL, 'Covasna', 0.00000000, 0.00000000, '2025-11-11 09:56:24', '2025-11-11 09:56:24'),
(79, 'Hărman', 'Hărman', 'Brașov', 0.00000000, 0.00000000, '2025-11-11 09:56:40', '2025-11-11 09:56:40'),
(80, 'Brașov', 'Brașov', 'Brașov', 0.00000000, 0.00000000, '2025-11-11 09:56:53', '2025-11-11 09:56:53');

-- --------------------------------------------------------

--
-- Table structure for table `traveler_defaults`
--

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
(838, 1, 2, '2025-11-10', '06:00:00', 0, 1),
(839, 1, 2, '2025-11-10', '07:00:00', 0, 3),
(840, 1, 1, '2025-11-10', '07:00:00', 0, 15),
(841, 1, 2, '2025-11-10', '09:00:00', 0, 5),
(842, 1, 2, '2025-11-10', '10:00:00', 0, 16),
(843, 1, 1, '2025-11-10', '11:30:00', 0, 6),
(844, 1, 2, '2025-11-10', '12:00:00', 0, 24),
(845, 1, 1, '2025-11-10', '13:00:00', 0, 19),
(846, 1, 2, '2025-11-10', '13:30:00', 0, 11),
(847, 1, 2, '2025-11-10', '14:00:00', 0, 20),
(848, 1, 1, '2025-11-10', '15:00:00', 0, 21),
(849, 1, 2, '2025-11-10', '15:30:00', 0, 12),
(850, 1, 1, '2025-11-10', '17:00:00', 0, 13),
(851, 1, 2, '2025-11-10', '17:00:00', 0, 22),
(852, 1, 1, '2025-11-10', '19:00:00', 0, 14),
(853, 1, 2, '2025-11-10', '19:00:00', 0, 23),
(854, 3, 1, '2025-11-10', '08:00:00', 0, 9),
(855, 3, 1, '2025-11-10', '16:00:00', 0, 10),
(856, 4, 1, '2025-11-10', '07:00:00', 0, 25),
(857, 4, 1, '2025-11-10', '11:00:00', 0, 26),
(858, 1, 2, '2025-11-11', '06:00:00', 0, 1),
(859, 1, 2, '2025-11-11', '07:00:00', 0, 3),
(860, 1, 1, '2025-11-11', '07:00:00', 0, 15),
(861, 1, 2, '2025-11-11', '09:00:00', 0, 5),
(862, 1, 2, '2025-11-11', '10:00:00', 0, 16),
(863, 1, 1, '2025-11-11', '11:30:00', 0, 6),
(864, 1, 2, '2025-11-11', '12:00:00', 0, 24),
(865, 1, 1, '2025-11-11', '13:00:00', 0, 19),
(866, 1, 2, '2025-11-11', '13:30:00', 0, 11),
(867, 1, 2, '2025-11-11', '14:00:00', 0, 20),
(868, 1, 1, '2025-11-11', '15:00:00', 0, 21),
(869, 1, 2, '2025-11-11', '15:30:00', 0, 12),
(870, 1, 1, '2025-11-11', '17:00:00', 0, 13),
(871, 1, 2, '2025-11-11', '17:00:00', 0, 22),
(872, 1, 1, '2025-11-11', '19:00:00', 0, 14),
(873, 1, 2, '2025-11-11', '19:00:00', 0, 23),
(874, 3, 1, '2025-11-11', '08:00:00', 0, 9),
(875, 3, 1, '2025-11-11', '16:00:00', 0, 10),
(876, 4, 1, '2025-11-11', '07:00:00', 0, 25),
(877, 4, 1, '2025-11-11', '11:00:00', 0, 26),
(878, 1, 2, '2025-11-12', '06:00:00', 0, 1),
(879, 1, 2, '2025-11-12', '07:00:00', 0, 3),
(880, 1, 1, '2025-11-12', '07:00:00', 0, 15),
(881, 1, 2, '2025-11-12', '09:00:00', 0, 5),
(882, 1, 2, '2025-11-12', '10:00:00', 0, 16),
(883, 1, 1, '2025-11-12', '11:30:00', 0, 6),
(884, 1, 2, '2025-11-12', '12:00:00', 0, 24),
(885, 1, 1, '2025-11-12', '13:00:00', 0, 19),
(886, 1, 2, '2025-11-12', '13:30:00', 0, 11),
(887, 1, 2, '2025-11-12', '14:00:00', 0, 20),
(888, 1, 1, '2025-11-12', '15:00:00', 0, 21),
(889, 1, 2, '2025-11-12', '15:30:00', 0, 12),
(890, 1, 1, '2025-11-12', '17:00:00', 0, 13),
(891, 1, 2, '2025-11-12', '17:00:00', 0, 22),
(892, 1, 1, '2025-11-12', '19:00:00', 0, 14),
(893, 1, 2, '2025-11-12', '19:00:00', 0, 23),
(894, 3, 1, '2025-11-12', '08:00:00', 0, 9),
(895, 3, 1, '2025-11-12', '16:00:00', 0, 10),
(896, 4, 1, '2025-11-12', '07:00:00', 0, 25),
(897, 4, 1, '2025-11-12', '11:00:00', 0, 26),
(898, 1, 2, '2025-11-13', '06:00:00', 0, 1),
(899, 1, 2, '2025-11-13', '07:00:00', 0, 3),
(900, 1, 1, '2025-11-13', '07:00:00', 0, 15),
(901, 1, 2, '2025-11-13', '09:00:00', 0, 5),
(902, 1, 2, '2025-11-13', '10:00:00', 0, 16),
(903, 1, 1, '2025-11-13', '11:30:00', 0, 6),
(904, 1, 2, '2025-11-13', '12:00:00', 0, 24),
(905, 1, 1, '2025-11-13', '13:00:00', 0, 19),
(906, 1, 2, '2025-11-13', '13:30:00', 0, 11),
(907, 1, 2, '2025-11-13', '14:00:00', 0, 20),
(908, 1, 1, '2025-11-13', '15:00:00', 0, 21),
(909, 1, 2, '2025-11-13', '15:30:00', 0, 12),
(910, 1, 1, '2025-11-13', '17:00:00', 0, 13),
(911, 1, 2, '2025-11-13', '17:00:00', 0, 22),
(912, 1, 1, '2025-11-13', '19:00:00', 0, 14),
(913, 1, 2, '2025-11-13', '19:00:00', 0, 23),
(914, 3, 1, '2025-11-13', '08:00:00', 0, 9),
(915, 3, 1, '2025-11-13', '16:00:00', 0, 10),
(916, 4, 1, '2025-11-13', '07:00:00', 0, 25),
(917, 4, 1, '2025-11-13', '11:00:00', 0, 26),
(918, 1, 2, '2025-11-14', '06:00:00', 0, 1),
(919, 1, 2, '2025-11-14', '07:00:00', 0, 3),
(920, 1, 1, '2025-11-14', '07:00:00', 0, 15),
(921, 1, 2, '2025-11-14', '09:00:00', 0, 5),
(922, 1, 2, '2025-11-14', '10:00:00', 0, 16),
(923, 1, 1, '2025-11-14', '11:30:00', 0, 6),
(924, 1, 2, '2025-11-14', '12:00:00', 0, 24),
(925, 1, 1, '2025-11-14', '13:00:00', 0, 19),
(926, 1, 2, '2025-11-14', '13:30:00', 0, 11),
(927, 1, 2, '2025-11-14', '14:00:00', 0, 20),
(928, 1, 1, '2025-11-14', '15:00:00', 0, 21),
(929, 1, 2, '2025-11-14', '15:30:00', 0, 12),
(930, 1, 1, '2025-11-14', '17:00:00', 0, 13),
(931, 1, 2, '2025-11-14', '17:00:00', 0, 22),
(932, 1, 1, '2025-11-14', '19:00:00', 0, 14),
(933, 1, 2, '2025-11-14', '19:00:00', 0, 23),
(934, 3, 1, '2025-11-14', '08:00:00', 0, 9),
(935, 3, 1, '2025-11-14', '16:00:00', 0, 10),
(936, 4, 1, '2025-11-14', '07:00:00', 0, 25),
(937, 4, 1, '2025-11-14', '11:00:00', 0, 26),
(938, 1, 2, '2025-11-15', '06:00:00', 0, 1),
(939, 1, 2, '2025-11-15', '07:00:00', 0, 3),
(940, 1, 1, '2025-11-15', '07:00:00', 0, 15),
(941, 1, 2, '2025-11-15', '09:00:00', 0, 5),
(942, 1, 2, '2025-11-15', '10:00:00', 0, 16),
(943, 1, 1, '2025-11-15', '11:30:00', 0, 6),
(944, 1, 2, '2025-11-15', '12:00:00', 0, 24),
(945, 1, 1, '2025-11-15', '13:00:00', 0, 19),
(946, 1, 2, '2025-11-15', '13:30:00', 0, 11),
(947, 1, 2, '2025-11-15', '14:00:00', 0, 20),
(948, 1, 1, '2025-11-15', '15:00:00', 0, 21),
(949, 1, 2, '2025-11-15', '15:30:00', 0, 12),
(950, 1, 1, '2025-11-15', '17:00:00', 0, 13),
(951, 1, 2, '2025-11-15', '17:00:00', 0, 22),
(952, 1, 1, '2025-11-15', '19:00:00', 0, 14),
(953, 1, 2, '2025-11-15', '19:00:00', 0, 23),
(954, 3, 1, '2025-11-15', '08:00:00', 0, 9),
(955, 3, 1, '2025-11-15', '16:00:00', 0, 10),
(956, 4, 1, '2025-11-15', '07:00:00', 0, 25),
(957, 4, 1, '2025-11-15', '11:00:00', 0, 26),
(958, 1, 2, '2025-11-16', '06:00:00', 0, 1),
(959, 1, 2, '2025-11-16', '07:00:00', 0, 3),
(960, 1, 1, '2025-11-16', '07:00:00', 0, 15),
(961, 1, 2, '2025-11-16', '09:00:00', 0, 5),
(962, 1, 2, '2025-11-16', '10:00:00', 0, 16),
(963, 1, 1, '2025-11-16', '11:30:00', 0, 6),
(964, 1, 2, '2025-11-16', '12:00:00', 0, 24),
(965, 1, 1, '2025-11-16', '13:00:00', 0, 19),
(966, 1, 2, '2025-11-16', '13:30:00', 0, 11),
(967, 1, 2, '2025-11-16', '14:00:00', 0, 20),
(968, 1, 1, '2025-11-16', '15:00:00', 0, 21),
(969, 1, 2, '2025-11-16', '15:30:00', 0, 12),
(970, 1, 1, '2025-11-16', '17:00:00', 0, 13),
(971, 1, 2, '2025-11-16', '17:00:00', 0, 22),
(972, 1, 1, '2025-11-16', '19:00:00', 0, 14),
(973, 1, 2, '2025-11-16', '19:00:00', 0, 23),
(974, 3, 1, '2025-11-16', '08:00:00', 0, 9),
(975, 3, 1, '2025-11-16', '16:00:00', 0, 10),
(976, 4, 1, '2025-11-16', '07:00:00', 0, 25),
(977, 4, 1, '2025-11-16', '11:00:00', 0, 26),
(978, 4, 1, '2026-02-20', '07:00:00', 0, 25),
(979, 1, 2, '2025-11-17', '06:00:00', 0, 1),
(980, 1, 2, '2025-11-17', '07:00:00', 0, 3),
(981, 1, 1, '2025-11-17', '07:00:00', 0, 15),
(982, 1, 2, '2025-11-17', '09:00:00', 0, 5),
(983, 1, 2, '2025-11-17', '10:00:00', 0, 16),
(984, 1, 1, '2025-11-17', '11:30:00', 0, 6),
(985, 1, 2, '2025-11-17', '12:00:00', 0, 24),
(986, 1, 1, '2025-11-17', '13:00:00', 0, 19),
(987, 1, 2, '2025-11-17', '13:30:00', 0, 11),
(988, 1, 2, '2025-11-17', '14:00:00', 0, 20),
(989, 1, 1, '2025-11-17', '15:00:00', 0, 21),
(990, 1, 2, '2025-11-17', '15:30:00', 0, 12),
(991, 1, 1, '2025-11-17', '17:00:00', 0, 13),
(992, 1, 2, '2025-11-17', '17:00:00', 0, 22),
(993, 1, 1, '2025-11-17', '19:00:00', 0, 14),
(994, 1, 2, '2025-11-17', '19:00:00', 0, 23),
(995, 3, 1, '2025-11-17', '08:00:00', 0, 9),
(996, 3, 1, '2025-11-17', '16:00:00', 0, 10),
(997, 4, 1, '2025-11-17', '07:00:00', 0, 25),
(998, 4, 1, '2025-11-17', '11:00:00', 0, 26),
(999, 5, 1, '2025-11-11', '08:00:00', 0, 27),
(1000, 5, 1, '2025-11-11', '16:00:00', 0, 28),
(1001, 5, 1, '2025-11-12', '08:00:00', 0, 27),
(1002, 5, 1, '2025-11-12', '16:00:00', 0, 28),
(1003, 5, 1, '2025-11-13', '08:00:00', 0, 27),
(1004, 5, 1, '2025-11-13', '16:00:00', 0, 28),
(1005, 5, 1, '2025-11-14', '08:00:00', 0, 27),
(1006, 5, 1, '2025-11-14', '16:00:00', 0, 28),
(1007, 5, 1, '2025-11-15', '08:00:00', 0, 27),
(1008, 5, 1, '2025-11-15', '16:00:00', 0, 28),
(1009, 5, 1, '2025-11-16', '08:00:00', 0, 27),
(1010, 5, 1, '2025-11-16', '16:00:00', 0, 28),
(1011, 5, 1, '2025-11-17', '08:00:00', 0, 27),
(1012, 5, 1, '2025-11-17', '16:00:00', 0, 28);

--
-- Triggers `trips`
--
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

CREATE TABLE `trip_stations` (
  `trip_id` int(11) NOT NULL,
  `station_id` int(11) NOT NULL,
  `sequence` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `trip_stations`
--

INSERT INTO `trip_stations` (`trip_id`, `station_id`, `sequence`) VALUES
(838, 1, 1),
(838, 3, 2),
(838, 2, 3),
(838, 61, 4),
(839, 1, 1),
(839, 3, 2),
(839, 2, 3),
(839, 61, 4),
(840, 61, 1),
(840, 2, 2),
(840, 3, 3),
(840, 1, 4),
(841, 1, 1),
(841, 3, 2),
(841, 2, 3),
(841, 61, 4),
(842, 61, 1),
(842, 2, 2),
(842, 3, 3),
(842, 1, 4),
(843, 1, 1),
(843, 3, 2),
(843, 2, 3),
(843, 61, 4),
(844, 61, 1),
(844, 2, 2),
(844, 3, 3),
(844, 1, 4),
(845, 61, 1),
(845, 2, 2),
(845, 3, 3),
(845, 1, 4),
(846, 1, 1),
(846, 3, 2),
(846, 2, 3),
(846, 61, 4),
(847, 61, 1),
(847, 2, 2),
(847, 3, 3),
(847, 1, 4),
(848, 61, 1),
(848, 2, 2),
(848, 3, 3),
(848, 1, 4),
(849, 1, 1),
(849, 3, 2),
(849, 2, 3),
(849, 61, 4),
(850, 1, 1),
(850, 3, 2),
(850, 2, 3),
(850, 61, 4),
(851, 61, 1),
(851, 2, 2),
(851, 3, 3),
(851, 1, 4),
(852, 1, 1),
(852, 3, 2),
(852, 2, 3),
(852, 61, 4),
(853, 61, 1),
(853, 2, 2),
(853, 3, 3),
(853, 1, 4),
(854, 45, 1),
(854, 44, 2),
(854, 43, 3),
(854, 42, 4),
(854, 41, 5),
(854, 40, 6),
(854, 39, 7),
(854, 38, 8),
(854, 37, 9),
(854, 36, 10),
(854, 35, 11),
(854, 34, 12),
(854, 33, 13),
(854, 32, 14),
(854, 31, 15),
(854, 30, 16),
(854, 1, 17),
(854, 29, 18),
(854, 28, 19),
(854, 27, 20),
(854, 26, 21),
(854, 25, 22),
(854, 6, 23),
(854, 7, 24),
(854, 8, 25),
(854, 4, 26),
(854, 9, 27),
(854, 5, 28),
(854, 24, 29),
(854, 3, 30),
(854, 23, 31),
(854, 22, 32),
(854, 21, 33),
(854, 10, 34),
(854, 11, 35),
(854, 12, 36),
(854, 20, 37),
(854, 19, 38),
(854, 18, 39),
(854, 17, 40),
(854, 16, 41),
(854, 15, 42),
(854, 14, 43),
(854, 13, 44),
(854, 2, 45),
(855, 2, 1),
(855, 13, 2),
(855, 14, 3),
(855, 15, 4),
(855, 16, 5),
(855, 17, 6),
(855, 18, 7),
(855, 19, 8),
(855, 20, 9),
(855, 12, 10),
(855, 11, 11),
(855, 10, 12),
(855, 21, 13),
(855, 22, 14),
(855, 23, 15),
(855, 3, 16),
(855, 24, 17),
(855, 5, 18),
(855, 9, 19),
(855, 4, 20),
(855, 8, 21),
(855, 7, 22),
(855, 6, 23),
(855, 25, 24),
(855, 26, 25),
(855, 27, 26),
(855, 28, 27),
(855, 29, 28),
(855, 1, 29),
(855, 30, 30),
(855, 31, 31),
(855, 32, 32),
(855, 33, 33),
(855, 34, 34),
(855, 35, 35),
(855, 36, 36),
(855, 37, 37),
(855, 38, 38),
(855, 39, 39),
(855, 40, 40),
(855, 41, 41),
(855, 42, 42),
(855, 43, 43),
(855, 44, 44),
(855, 45, 45),
(856, 46, 1),
(856, 47, 2),
(856, 48, 3),
(856, 49, 4),
(856, 50, 5),
(856, 51, 6),
(856, 52, 7),
(856, 54, 8),
(856, 53, 9),
(856, 31, 10),
(856, 30, 11),
(856, 1, 12),
(856, 29, 13),
(856, 28, 14),
(856, 27, 15),
(856, 26, 16),
(856, 25, 17),
(856, 6, 18),
(856, 7, 19),
(856, 8, 20),
(856, 4, 21),
(856, 9, 22),
(856, 5, 23),
(856, 24, 24),
(856, 3, 25),
(856, 23, 26),
(856, 22, 27),
(856, 21, 28),
(856, 10, 29),
(856, 11, 30),
(856, 12, 31),
(856, 20, 32),
(856, 19, 33),
(856, 18, 34),
(856, 17, 35),
(856, 16, 36),
(856, 15, 37),
(856, 14, 38),
(856, 13, 39),
(856, 2, 40),
(857, 2, 1),
(857, 13, 2),
(857, 14, 3),
(857, 15, 4),
(857, 16, 5),
(857, 17, 6),
(857, 18, 7),
(857, 19, 8),
(857, 20, 9),
(857, 12, 10),
(857, 11, 11),
(857, 10, 12),
(857, 21, 13),
(857, 22, 14),
(857, 23, 15),
(857, 3, 16),
(857, 24, 17),
(857, 5, 18),
(857, 9, 19),
(857, 4, 20),
(857, 8, 21),
(857, 7, 22),
(857, 6, 23),
(857, 25, 24),
(857, 26, 25),
(857, 27, 26),
(857, 28, 27),
(857, 29, 28),
(857, 1, 29),
(857, 30, 30),
(857, 31, 31),
(857, 53, 32),
(857, 54, 33),
(857, 52, 34),
(857, 51, 35),
(857, 50, 36),
(857, 49, 37),
(857, 48, 38),
(857, 47, 39),
(857, 46, 40),
(858, 1, 1),
(858, 3, 2),
(858, 2, 3),
(858, 61, 4),
(859, 1, 1),
(859, 3, 2),
(859, 2, 3),
(859, 61, 4),
(860, 61, 1),
(860, 2, 2),
(860, 3, 3),
(860, 1, 4),
(861, 1, 1),
(861, 3, 2),
(861, 2, 3),
(861, 61, 4),
(862, 61, 1),
(862, 2, 2),
(862, 3, 3),
(862, 1, 4),
(863, 1, 1),
(863, 3, 2),
(863, 2, 3),
(863, 61, 4),
(864, 61, 1),
(864, 2, 2),
(864, 3, 3),
(864, 1, 4),
(865, 61, 1),
(865, 2, 2),
(865, 3, 3),
(865, 1, 4),
(866, 1, 1),
(866, 3, 2),
(866, 2, 3),
(866, 61, 4),
(867, 61, 1),
(867, 2, 2),
(867, 3, 3),
(867, 1, 4),
(868, 61, 1),
(868, 2, 2),
(868, 3, 3),
(868, 1, 4),
(869, 1, 1),
(869, 3, 2),
(869, 2, 3),
(869, 61, 4),
(870, 1, 1),
(870, 3, 2),
(870, 2, 3),
(870, 61, 4),
(871, 61, 1),
(871, 2, 2),
(871, 3, 3),
(871, 1, 4),
(872, 1, 1),
(872, 3, 2),
(872, 2, 3),
(872, 61, 4),
(873, 61, 1),
(873, 2, 2),
(873, 3, 3),
(873, 1, 4),
(874, 45, 1),
(874, 44, 2),
(874, 43, 3),
(874, 42, 4),
(874, 41, 5),
(874, 40, 6),
(874, 39, 7),
(874, 38, 8),
(874, 37, 9),
(874, 36, 10),
(874, 35, 11),
(874, 34, 12),
(874, 33, 13),
(874, 32, 14),
(874, 31, 15),
(874, 30, 16),
(874, 1, 17),
(874, 29, 18),
(874, 28, 19),
(874, 27, 20),
(874, 26, 21),
(874, 25, 22),
(874, 6, 23),
(874, 7, 24),
(874, 8, 25),
(874, 4, 26),
(874, 9, 27),
(874, 5, 28),
(874, 24, 29),
(874, 3, 30),
(874, 23, 31),
(874, 22, 32),
(874, 21, 33),
(874, 10, 34),
(874, 11, 35),
(874, 12, 36),
(874, 20, 37),
(874, 19, 38),
(874, 18, 39),
(874, 17, 40),
(874, 16, 41),
(874, 15, 42),
(874, 14, 43),
(874, 13, 44),
(874, 2, 45),
(875, 2, 1),
(875, 13, 2),
(875, 14, 3),
(875, 15, 4),
(875, 16, 5),
(875, 17, 6),
(875, 18, 7),
(875, 19, 8),
(875, 20, 9),
(875, 12, 10),
(875, 11, 11),
(875, 10, 12),
(875, 21, 13),
(875, 22, 14),
(875, 23, 15),
(875, 3, 16),
(875, 24, 17),
(875, 5, 18),
(875, 9, 19),
(875, 4, 20),
(875, 8, 21),
(875, 7, 22),
(875, 6, 23),
(875, 25, 24),
(875, 26, 25),
(875, 27, 26),
(875, 28, 27),
(875, 29, 28),
(875, 1, 29),
(875, 30, 30),
(875, 31, 31),
(875, 32, 32),
(875, 33, 33),
(875, 34, 34),
(875, 35, 35),
(875, 36, 36),
(875, 37, 37),
(875, 38, 38),
(875, 39, 39),
(875, 40, 40),
(875, 41, 41),
(875, 42, 42),
(875, 43, 43),
(875, 44, 44),
(875, 45, 45),
(876, 46, 1),
(876, 47, 2),
(876, 48, 3),
(876, 49, 4),
(876, 50, 5),
(876, 51, 6),
(876, 52, 7),
(876, 54, 8),
(876, 53, 9),
(876, 31, 10),
(876, 30, 11),
(876, 1, 12),
(876, 29, 13),
(876, 28, 14),
(876, 27, 15),
(876, 26, 16),
(876, 25, 17),
(876, 6, 18),
(876, 7, 19),
(876, 8, 20),
(876, 4, 21),
(876, 9, 22),
(876, 5, 23),
(876, 24, 24),
(876, 3, 25),
(876, 23, 26),
(876, 22, 27),
(876, 21, 28),
(876, 10, 29),
(876, 11, 30),
(876, 12, 31),
(876, 20, 32),
(876, 19, 33),
(876, 18, 34),
(876, 17, 35),
(876, 16, 36),
(876, 15, 37),
(876, 14, 38),
(876, 13, 39),
(876, 2, 40),
(877, 2, 1),
(877, 13, 2),
(877, 14, 3),
(877, 15, 4),
(877, 16, 5),
(877, 17, 6),
(877, 18, 7),
(877, 19, 8),
(877, 20, 9),
(877, 12, 10),
(877, 11, 11),
(877, 10, 12),
(877, 21, 13),
(877, 22, 14),
(877, 23, 15),
(877, 3, 16),
(877, 24, 17),
(877, 5, 18),
(877, 9, 19),
(877, 4, 20),
(877, 8, 21),
(877, 7, 22),
(877, 6, 23),
(877, 25, 24),
(877, 26, 25),
(877, 27, 26),
(877, 28, 27),
(877, 29, 28),
(877, 1, 29),
(877, 30, 30),
(877, 31, 31),
(877, 53, 32),
(877, 54, 33),
(877, 52, 34),
(877, 51, 35),
(877, 50, 36),
(877, 49, 37),
(877, 48, 38),
(877, 47, 39),
(877, 46, 40),
(878, 1, 1),
(878, 3, 2),
(878, 2, 3),
(878, 61, 4),
(879, 1, 1),
(879, 3, 2),
(879, 2, 3),
(879, 61, 4),
(880, 61, 1),
(880, 2, 2),
(880, 3, 3),
(880, 1, 4),
(881, 1, 1),
(881, 3, 2),
(881, 2, 3),
(881, 61, 4),
(882, 61, 1),
(882, 2, 2),
(882, 3, 3),
(882, 1, 4),
(883, 1, 1),
(883, 3, 2),
(883, 2, 3),
(883, 61, 4),
(884, 61, 1),
(884, 2, 2),
(884, 3, 3),
(884, 1, 4),
(885, 61, 1),
(885, 2, 2),
(885, 3, 3),
(885, 1, 4),
(886, 1, 1),
(886, 3, 2),
(886, 2, 3),
(886, 61, 4),
(887, 61, 1),
(887, 2, 2),
(887, 3, 3),
(887, 1, 4),
(888, 61, 1),
(888, 2, 2),
(888, 3, 3),
(888, 1, 4),
(889, 1, 1),
(889, 3, 2),
(889, 2, 3),
(889, 61, 4),
(890, 1, 1),
(890, 3, 2),
(890, 2, 3),
(890, 61, 4),
(891, 61, 1),
(891, 2, 2),
(891, 3, 3),
(891, 1, 4),
(892, 1, 1),
(892, 3, 2),
(892, 2, 3),
(892, 61, 4),
(893, 61, 1),
(893, 2, 2),
(893, 3, 3),
(893, 1, 4),
(894, 45, 1),
(894, 44, 2),
(894, 43, 3),
(894, 42, 4),
(894, 41, 5),
(894, 40, 6),
(894, 39, 7),
(894, 38, 8),
(894, 37, 9),
(894, 36, 10),
(894, 35, 11),
(894, 34, 12),
(894, 33, 13),
(894, 32, 14),
(894, 31, 15),
(894, 30, 16),
(894, 1, 17),
(894, 29, 18),
(894, 28, 19),
(894, 27, 20),
(894, 26, 21),
(894, 25, 22),
(894, 6, 23),
(894, 7, 24),
(894, 8, 25),
(894, 4, 26),
(894, 9, 27),
(894, 5, 28),
(894, 24, 29),
(894, 3, 30),
(894, 23, 31),
(894, 22, 32),
(894, 21, 33),
(894, 10, 34),
(894, 11, 35),
(894, 12, 36),
(894, 20, 37),
(894, 19, 38),
(894, 18, 39),
(894, 17, 40),
(894, 16, 41),
(894, 15, 42),
(894, 14, 43),
(894, 13, 44),
(894, 2, 45),
(895, 2, 1),
(895, 13, 2),
(895, 14, 3),
(895, 15, 4),
(895, 16, 5),
(895, 17, 6),
(895, 18, 7),
(895, 19, 8),
(895, 20, 9),
(895, 12, 10),
(895, 11, 11),
(895, 10, 12),
(895, 21, 13),
(895, 22, 14),
(895, 23, 15),
(895, 3, 16),
(895, 24, 17),
(895, 5, 18),
(895, 9, 19),
(895, 4, 20),
(895, 8, 21),
(895, 7, 22),
(895, 6, 23),
(895, 25, 24),
(895, 26, 25),
(895, 27, 26),
(895, 28, 27),
(895, 29, 28),
(895, 1, 29),
(895, 30, 30),
(895, 31, 31),
(895, 32, 32),
(895, 33, 33),
(895, 34, 34),
(895, 35, 35),
(895, 36, 36),
(895, 37, 37),
(895, 38, 38),
(895, 39, 39),
(895, 40, 40),
(895, 41, 41),
(895, 42, 42),
(895, 43, 43),
(895, 44, 44),
(895, 45, 45),
(896, 46, 1),
(896, 47, 2),
(896, 48, 3),
(896, 49, 4),
(896, 50, 5),
(896, 51, 6),
(896, 52, 7),
(896, 54, 8),
(896, 53, 9),
(896, 31, 10),
(896, 30, 11),
(896, 1, 12),
(896, 29, 13),
(896, 28, 14),
(896, 27, 15),
(896, 26, 16),
(896, 25, 17),
(896, 6, 18),
(896, 7, 19),
(896, 8, 20),
(896, 4, 21),
(896, 9, 22),
(896, 5, 23),
(896, 24, 24),
(896, 3, 25),
(896, 23, 26),
(896, 22, 27),
(896, 21, 28),
(896, 10, 29),
(896, 11, 30),
(896, 12, 31),
(896, 20, 32),
(896, 19, 33),
(896, 18, 34),
(896, 17, 35),
(896, 16, 36),
(896, 15, 37),
(896, 14, 38),
(896, 13, 39),
(896, 2, 40),
(897, 2, 1),
(897, 13, 2),
(897, 14, 3),
(897, 15, 4),
(897, 16, 5),
(897, 17, 6),
(897, 18, 7),
(897, 19, 8),
(897, 20, 9),
(897, 12, 10),
(897, 11, 11),
(897, 10, 12),
(897, 21, 13),
(897, 22, 14),
(897, 23, 15),
(897, 3, 16),
(897, 24, 17),
(897, 5, 18),
(897, 9, 19),
(897, 4, 20),
(897, 8, 21),
(897, 7, 22),
(897, 6, 23),
(897, 25, 24),
(897, 26, 25),
(897, 27, 26),
(897, 28, 27),
(897, 29, 28),
(897, 1, 29),
(897, 30, 30),
(897, 31, 31),
(897, 53, 32),
(897, 54, 33),
(897, 52, 34),
(897, 51, 35),
(897, 50, 36),
(897, 49, 37),
(897, 48, 38),
(897, 47, 39),
(897, 46, 40),
(898, 1, 1),
(898, 3, 2),
(898, 2, 3),
(898, 61, 4),
(899, 1, 1),
(899, 3, 2),
(899, 2, 3),
(899, 61, 4),
(900, 61, 1),
(900, 2, 2),
(900, 3, 3),
(900, 1, 4),
(901, 1, 1),
(901, 3, 2),
(901, 2, 3),
(901, 61, 4),
(902, 61, 1),
(902, 2, 2),
(902, 3, 3),
(902, 1, 4),
(903, 1, 1),
(903, 3, 2),
(903, 2, 3),
(903, 61, 4),
(904, 61, 1),
(904, 2, 2),
(904, 3, 3),
(904, 1, 4),
(905, 61, 1),
(905, 2, 2),
(905, 3, 3),
(905, 1, 4),
(906, 1, 1),
(906, 3, 2),
(906, 2, 3),
(906, 61, 4),
(907, 61, 1),
(907, 2, 2),
(907, 3, 3),
(907, 1, 4),
(908, 61, 1),
(908, 2, 2),
(908, 3, 3),
(908, 1, 4),
(909, 1, 1),
(909, 3, 2),
(909, 2, 3),
(909, 61, 4),
(910, 1, 1),
(910, 3, 2),
(910, 2, 3),
(910, 61, 4),
(911, 61, 1),
(911, 2, 2),
(911, 3, 3),
(911, 1, 4),
(912, 1, 1),
(912, 3, 2),
(912, 2, 3),
(912, 61, 4),
(913, 61, 1),
(913, 2, 2),
(913, 3, 3),
(913, 1, 4),
(914, 45, 1),
(914, 44, 2),
(914, 43, 3),
(914, 42, 4),
(914, 41, 5),
(914, 40, 6),
(914, 39, 7),
(914, 38, 8),
(914, 37, 9),
(914, 36, 10),
(914, 35, 11),
(914, 34, 12),
(914, 33, 13),
(914, 32, 14),
(914, 31, 15),
(914, 30, 16),
(914, 1, 17),
(914, 29, 18),
(914, 28, 19),
(914, 27, 20),
(914, 26, 21),
(914, 25, 22),
(914, 6, 23),
(914, 7, 24),
(914, 8, 25),
(914, 4, 26),
(914, 9, 27),
(914, 5, 28),
(914, 24, 29),
(914, 3, 30),
(914, 23, 31),
(914, 22, 32),
(914, 21, 33),
(914, 10, 34),
(914, 11, 35),
(914, 12, 36),
(914, 20, 37),
(914, 19, 38),
(914, 18, 39),
(914, 17, 40),
(914, 16, 41),
(914, 15, 42),
(914, 14, 43),
(914, 13, 44),
(914, 2, 45),
(915, 2, 1),
(915, 13, 2),
(915, 14, 3),
(915, 15, 4),
(915, 16, 5),
(915, 17, 6),
(915, 18, 7),
(915, 19, 8),
(915, 20, 9),
(915, 12, 10),
(915, 11, 11),
(915, 10, 12),
(915, 21, 13),
(915, 22, 14),
(915, 23, 15),
(915, 3, 16),
(915, 24, 17),
(915, 5, 18),
(915, 9, 19),
(915, 4, 20),
(915, 8, 21),
(915, 7, 22),
(915, 6, 23),
(915, 25, 24),
(915, 26, 25),
(915, 27, 26),
(915, 28, 27),
(915, 29, 28),
(915, 1, 29),
(915, 30, 30),
(915, 31, 31),
(915, 32, 32),
(915, 33, 33),
(915, 34, 34),
(915, 35, 35),
(915, 36, 36),
(915, 37, 37),
(915, 38, 38),
(915, 39, 39),
(915, 40, 40),
(915, 41, 41),
(915, 42, 42),
(915, 43, 43),
(915, 44, 44),
(915, 45, 45),
(916, 46, 1),
(916, 47, 2),
(916, 48, 3),
(916, 49, 4),
(916, 50, 5),
(916, 51, 6),
(916, 52, 7),
(916, 54, 8),
(916, 53, 9),
(916, 31, 10),
(916, 30, 11),
(916, 1, 12),
(916, 29, 13),
(916, 28, 14),
(916, 27, 15),
(916, 26, 16),
(916, 25, 17),
(916, 6, 18),
(916, 7, 19),
(916, 8, 20),
(916, 4, 21),
(916, 9, 22),
(916, 5, 23),
(916, 24, 24),
(916, 3, 25),
(916, 23, 26),
(916, 22, 27),
(916, 21, 28),
(916, 10, 29),
(916, 11, 30),
(916, 12, 31),
(916, 20, 32),
(916, 19, 33),
(916, 18, 34),
(916, 17, 35),
(916, 16, 36),
(916, 15, 37),
(916, 14, 38),
(916, 13, 39),
(916, 2, 40),
(917, 2, 1),
(917, 13, 2),
(917, 14, 3),
(917, 15, 4),
(917, 16, 5),
(917, 17, 6),
(917, 18, 7),
(917, 19, 8),
(917, 20, 9),
(917, 12, 10),
(917, 11, 11),
(917, 10, 12),
(917, 21, 13),
(917, 22, 14),
(917, 23, 15),
(917, 3, 16),
(917, 24, 17),
(917, 5, 18),
(917, 9, 19),
(917, 4, 20),
(917, 8, 21),
(917, 7, 22),
(917, 6, 23),
(917, 25, 24),
(917, 26, 25),
(917, 27, 26),
(917, 28, 27),
(917, 29, 28),
(917, 1, 29),
(917, 30, 30),
(917, 31, 31),
(917, 53, 32),
(917, 54, 33),
(917, 52, 34),
(917, 51, 35),
(917, 50, 36),
(917, 49, 37),
(917, 48, 38),
(917, 47, 39),
(917, 46, 40),
(918, 1, 1),
(918, 3, 2),
(918, 2, 3),
(918, 61, 4),
(919, 1, 1),
(919, 3, 2),
(919, 2, 3),
(919, 61, 4),
(920, 61, 1),
(920, 2, 2),
(920, 3, 3),
(920, 1, 4),
(921, 1, 1),
(921, 3, 2),
(921, 2, 3),
(921, 61, 4),
(922, 61, 1),
(922, 2, 2),
(922, 3, 3),
(922, 1, 4),
(923, 1, 1),
(923, 3, 2),
(923, 2, 3),
(923, 61, 4),
(924, 61, 1),
(924, 2, 2),
(924, 3, 3),
(924, 1, 4),
(925, 61, 1),
(925, 2, 2),
(925, 3, 3),
(925, 1, 4),
(926, 1, 1),
(926, 3, 2),
(926, 2, 3),
(926, 61, 4),
(927, 61, 1),
(927, 2, 2),
(927, 3, 3),
(927, 1, 4),
(928, 61, 1),
(928, 2, 2),
(928, 3, 3),
(928, 1, 4),
(929, 1, 1),
(929, 3, 2),
(929, 2, 3),
(929, 61, 4),
(930, 1, 1),
(930, 3, 2),
(930, 2, 3),
(930, 61, 4),
(931, 61, 1),
(931, 2, 2),
(931, 3, 3),
(931, 1, 4),
(932, 1, 1),
(932, 3, 2),
(932, 2, 3),
(932, 61, 4),
(933, 61, 1),
(933, 2, 2),
(933, 3, 3),
(933, 1, 4),
(934, 45, 1),
(934, 44, 2),
(934, 43, 3),
(934, 42, 4),
(934, 41, 5),
(934, 40, 6),
(934, 39, 7),
(934, 38, 8),
(934, 37, 9),
(934, 36, 10),
(934, 35, 11),
(934, 34, 12),
(934, 33, 13),
(934, 32, 14),
(934, 31, 15),
(934, 30, 16),
(934, 1, 17),
(934, 29, 18),
(934, 28, 19),
(934, 27, 20),
(934, 26, 21),
(934, 25, 22),
(934, 6, 23),
(934, 7, 24),
(934, 8, 25),
(934, 4, 26),
(934, 9, 27),
(934, 5, 28),
(934, 24, 29),
(934, 3, 30),
(934, 23, 31),
(934, 22, 32),
(934, 21, 33),
(934, 10, 34),
(934, 11, 35),
(934, 12, 36),
(934, 20, 37),
(934, 19, 38),
(934, 18, 39),
(934, 17, 40),
(934, 16, 41),
(934, 15, 42),
(934, 14, 43),
(934, 13, 44),
(934, 2, 45),
(935, 2, 1),
(935, 13, 2),
(935, 14, 3),
(935, 15, 4),
(935, 16, 5),
(935, 17, 6),
(935, 18, 7),
(935, 19, 8),
(935, 20, 9),
(935, 12, 10),
(935, 11, 11),
(935, 10, 12),
(935, 21, 13),
(935, 22, 14),
(935, 23, 15),
(935, 3, 16),
(935, 24, 17),
(935, 5, 18),
(935, 9, 19),
(935, 4, 20),
(935, 8, 21),
(935, 7, 22),
(935, 6, 23),
(935, 25, 24),
(935, 26, 25),
(935, 27, 26),
(935, 28, 27),
(935, 29, 28),
(935, 1, 29),
(935, 30, 30),
(935, 31, 31),
(935, 32, 32),
(935, 33, 33),
(935, 34, 34),
(935, 35, 35),
(935, 36, 36),
(935, 37, 37),
(935, 38, 38),
(935, 39, 39),
(935, 40, 40),
(935, 41, 41),
(935, 42, 42),
(935, 43, 43),
(935, 44, 44),
(935, 45, 45),
(936, 46, 1),
(936, 47, 2),
(936, 48, 3),
(936, 49, 4),
(936, 50, 5),
(936, 51, 6),
(936, 52, 7),
(936, 54, 8),
(936, 53, 9),
(936, 31, 10),
(936, 30, 11),
(936, 1, 12),
(936, 29, 13),
(936, 28, 14),
(936, 27, 15),
(936, 26, 16),
(936, 25, 17),
(936, 6, 18),
(936, 7, 19),
(936, 8, 20),
(936, 4, 21),
(936, 9, 22),
(936, 5, 23),
(936, 24, 24),
(936, 3, 25),
(936, 23, 26),
(936, 22, 27),
(936, 21, 28),
(936, 10, 29),
(936, 11, 30),
(936, 12, 31),
(936, 20, 32),
(936, 19, 33),
(936, 18, 34),
(936, 17, 35),
(936, 16, 36),
(936, 15, 37),
(936, 14, 38),
(936, 13, 39),
(936, 2, 40),
(937, 2, 1),
(937, 13, 2),
(937, 14, 3),
(937, 15, 4),
(937, 16, 5),
(937, 17, 6),
(937, 18, 7),
(937, 19, 8),
(937, 20, 9),
(937, 12, 10),
(937, 11, 11),
(937, 10, 12),
(937, 21, 13),
(937, 22, 14),
(937, 23, 15),
(937, 3, 16),
(937, 24, 17),
(937, 5, 18),
(937, 9, 19),
(937, 4, 20),
(937, 8, 21),
(937, 7, 22),
(937, 6, 23),
(937, 25, 24),
(937, 26, 25),
(937, 27, 26),
(937, 28, 27),
(937, 29, 28),
(937, 1, 29),
(937, 30, 30),
(937, 31, 31),
(937, 53, 32),
(937, 54, 33),
(937, 52, 34),
(937, 51, 35),
(937, 50, 36),
(937, 49, 37),
(937, 48, 38),
(937, 47, 39),
(937, 46, 40),
(938, 1, 1),
(938, 3, 2),
(938, 2, 3),
(938, 61, 4),
(939, 1, 1),
(939, 3, 2),
(939, 2, 3),
(939, 61, 4),
(940, 61, 1),
(940, 2, 2),
(940, 3, 3),
(940, 1, 4),
(941, 1, 1),
(941, 3, 2),
(941, 2, 3),
(941, 61, 4),
(942, 61, 1),
(942, 2, 2),
(942, 3, 3),
(942, 1, 4),
(943, 1, 1),
(943, 3, 2),
(943, 2, 3),
(943, 61, 4),
(944, 61, 1),
(944, 2, 2),
(944, 3, 3),
(944, 1, 4),
(945, 61, 1),
(945, 2, 2),
(945, 3, 3),
(945, 1, 4),
(946, 1, 1),
(946, 3, 2),
(946, 2, 3),
(946, 61, 4),
(947, 61, 1),
(947, 2, 2),
(947, 3, 3),
(947, 1, 4),
(948, 61, 1),
(948, 2, 2),
(948, 3, 3),
(948, 1, 4),
(949, 1, 1),
(949, 3, 2),
(949, 2, 3),
(949, 61, 4),
(950, 1, 1),
(950, 3, 2),
(950, 2, 3),
(950, 61, 4),
(951, 61, 1),
(951, 2, 2),
(951, 3, 3),
(951, 1, 4),
(952, 1, 1),
(952, 3, 2),
(952, 2, 3),
(952, 61, 4),
(953, 61, 1),
(953, 2, 2),
(953, 3, 3),
(953, 1, 4),
(954, 45, 1),
(954, 44, 2),
(954, 43, 3),
(954, 42, 4),
(954, 41, 5),
(954, 40, 6),
(954, 39, 7),
(954, 38, 8),
(954, 37, 9),
(954, 36, 10),
(954, 35, 11),
(954, 34, 12),
(954, 33, 13),
(954, 32, 14),
(954, 31, 15),
(954, 30, 16),
(954, 1, 17),
(954, 29, 18),
(954, 28, 19),
(954, 27, 20),
(954, 26, 21),
(954, 25, 22),
(954, 6, 23),
(954, 7, 24),
(954, 8, 25),
(954, 4, 26),
(954, 9, 27),
(954, 5, 28),
(954, 24, 29),
(954, 3, 30),
(954, 23, 31),
(954, 22, 32),
(954, 21, 33),
(954, 10, 34),
(954, 11, 35),
(954, 12, 36),
(954, 20, 37),
(954, 19, 38),
(954, 18, 39),
(954, 17, 40),
(954, 16, 41),
(954, 15, 42),
(954, 14, 43),
(954, 13, 44),
(954, 2, 45),
(955, 2, 1),
(955, 13, 2),
(955, 14, 3),
(955, 15, 4),
(955, 16, 5),
(955, 17, 6),
(955, 18, 7),
(955, 19, 8),
(955, 20, 9),
(955, 12, 10),
(955, 11, 11),
(955, 10, 12),
(955, 21, 13),
(955, 22, 14),
(955, 23, 15),
(955, 3, 16),
(955, 24, 17),
(955, 5, 18),
(955, 9, 19),
(955, 4, 20),
(955, 8, 21),
(955, 7, 22),
(955, 6, 23),
(955, 25, 24),
(955, 26, 25),
(955, 27, 26),
(955, 28, 27),
(955, 29, 28),
(955, 1, 29),
(955, 30, 30),
(955, 31, 31),
(955, 32, 32),
(955, 33, 33),
(955, 34, 34),
(955, 35, 35),
(955, 36, 36),
(955, 37, 37),
(955, 38, 38),
(955, 39, 39),
(955, 40, 40),
(955, 41, 41),
(955, 42, 42),
(955, 43, 43),
(955, 44, 44),
(955, 45, 45),
(956, 46, 1),
(956, 47, 2),
(956, 48, 3),
(956, 49, 4),
(956, 50, 5),
(956, 51, 6),
(956, 52, 7),
(956, 54, 8),
(956, 53, 9),
(956, 31, 10),
(956, 30, 11),
(956, 1, 12),
(956, 29, 13),
(956, 28, 14),
(956, 27, 15),
(956, 26, 16),
(956, 25, 17),
(956, 6, 18),
(956, 7, 19),
(956, 8, 20),
(956, 4, 21),
(956, 9, 22),
(956, 5, 23),
(956, 24, 24),
(956, 3, 25),
(956, 23, 26),
(956, 22, 27),
(956, 21, 28),
(956, 10, 29),
(956, 11, 30),
(956, 12, 31),
(956, 20, 32),
(956, 19, 33),
(956, 18, 34),
(956, 17, 35),
(956, 16, 36),
(956, 15, 37),
(956, 14, 38),
(956, 13, 39),
(956, 2, 40),
(957, 2, 1),
(957, 13, 2),
(957, 14, 3),
(957, 15, 4),
(957, 16, 5),
(957, 17, 6),
(957, 18, 7),
(957, 19, 8),
(957, 20, 9),
(957, 12, 10),
(957, 11, 11),
(957, 10, 12),
(957, 21, 13),
(957, 22, 14),
(957, 23, 15),
(957, 3, 16),
(957, 24, 17),
(957, 5, 18),
(957, 9, 19),
(957, 4, 20),
(957, 8, 21),
(957, 7, 22),
(957, 6, 23),
(957, 25, 24),
(957, 26, 25),
(957, 27, 26),
(957, 28, 27),
(957, 29, 28),
(957, 1, 29),
(957, 30, 30),
(957, 31, 31),
(957, 53, 32),
(957, 54, 33),
(957, 52, 34),
(957, 51, 35),
(957, 50, 36),
(957, 49, 37),
(957, 48, 38),
(957, 47, 39),
(957, 46, 40),
(958, 1, 1),
(958, 3, 2),
(958, 2, 3),
(958, 61, 4),
(959, 1, 1),
(959, 3, 2),
(959, 2, 3),
(959, 61, 4),
(960, 61, 1),
(960, 2, 2),
(960, 3, 3),
(960, 1, 4),
(961, 1, 1),
(961, 3, 2),
(961, 2, 3),
(961, 61, 4),
(962, 61, 1),
(962, 2, 2),
(962, 3, 3),
(962, 1, 4),
(963, 1, 1),
(963, 3, 2),
(963, 2, 3),
(963, 61, 4),
(964, 61, 1),
(964, 2, 2),
(964, 3, 3),
(964, 1, 4),
(965, 61, 1),
(965, 2, 2),
(965, 3, 3),
(965, 1, 4),
(966, 1, 1),
(966, 3, 2),
(966, 2, 3),
(966, 61, 4),
(967, 61, 1),
(967, 2, 2),
(967, 3, 3),
(967, 1, 4),
(968, 61, 1),
(968, 2, 2),
(968, 3, 3),
(968, 1, 4),
(969, 1, 1),
(969, 3, 2),
(969, 2, 3),
(969, 61, 4),
(970, 1, 1),
(970, 3, 2),
(970, 2, 3),
(970, 61, 4),
(971, 61, 1),
(971, 2, 2),
(971, 3, 3),
(971, 1, 4),
(972, 1, 1),
(972, 3, 2),
(972, 2, 3),
(972, 61, 4),
(973, 61, 1),
(973, 2, 2),
(973, 3, 3),
(973, 1, 4),
(974, 45, 1),
(974, 44, 2),
(974, 43, 3),
(974, 42, 4),
(974, 41, 5),
(974, 40, 6),
(974, 39, 7),
(974, 38, 8),
(974, 37, 9),
(974, 36, 10),
(974, 35, 11),
(974, 34, 12),
(974, 33, 13),
(974, 32, 14),
(974, 31, 15),
(974, 30, 16),
(974, 1, 17),
(974, 29, 18),
(974, 28, 19),
(974, 27, 20),
(974, 26, 21),
(974, 25, 22),
(974, 6, 23),
(974, 7, 24),
(974, 8, 25),
(974, 4, 26),
(974, 9, 27),
(974, 5, 28),
(974, 24, 29),
(974, 3, 30),
(974, 23, 31),
(974, 22, 32),
(974, 21, 33),
(974, 10, 34),
(974, 11, 35),
(974, 12, 36),
(974, 20, 37),
(974, 19, 38),
(974, 18, 39),
(974, 17, 40),
(974, 16, 41),
(974, 15, 42),
(974, 14, 43),
(974, 13, 44),
(974, 2, 45),
(975, 2, 1),
(975, 13, 2),
(975, 14, 3),
(975, 15, 4),
(975, 16, 5),
(975, 17, 6),
(975, 18, 7),
(975, 19, 8),
(975, 20, 9),
(975, 12, 10),
(975, 11, 11),
(975, 10, 12),
(975, 21, 13),
(975, 22, 14),
(975, 23, 15),
(975, 3, 16),
(975, 24, 17),
(975, 5, 18),
(975, 9, 19),
(975, 4, 20),
(975, 8, 21),
(975, 7, 22),
(975, 6, 23),
(975, 25, 24),
(975, 26, 25),
(975, 27, 26),
(975, 28, 27),
(975, 29, 28),
(975, 1, 29),
(975, 30, 30),
(975, 31, 31),
(975, 32, 32),
(975, 33, 33),
(975, 34, 34),
(975, 35, 35),
(975, 36, 36),
(975, 37, 37),
(975, 38, 38),
(975, 39, 39),
(975, 40, 40),
(975, 41, 41),
(975, 42, 42),
(975, 43, 43),
(975, 44, 44),
(975, 45, 45),
(976, 46, 1),
(976, 47, 2),
(976, 48, 3),
(976, 49, 4),
(976, 50, 5),
(976, 51, 6),
(976, 52, 7),
(976, 54, 8),
(976, 53, 9),
(976, 31, 10),
(976, 30, 11),
(976, 1, 12),
(976, 29, 13),
(976, 28, 14),
(976, 27, 15),
(976, 26, 16),
(976, 25, 17),
(976, 6, 18),
(976, 7, 19),
(976, 8, 20),
(976, 4, 21),
(976, 9, 22),
(976, 5, 23),
(976, 24, 24),
(976, 3, 25),
(976, 23, 26),
(976, 22, 27),
(976, 21, 28),
(976, 10, 29),
(976, 11, 30),
(976, 12, 31),
(976, 20, 32),
(976, 19, 33),
(976, 18, 34),
(976, 17, 35),
(976, 16, 36),
(976, 15, 37),
(976, 14, 38),
(976, 13, 39),
(976, 2, 40),
(977, 2, 1),
(977, 13, 2),
(977, 14, 3),
(977, 15, 4),
(977, 16, 5),
(977, 17, 6),
(977, 18, 7),
(977, 19, 8),
(977, 20, 9),
(977, 12, 10),
(977, 11, 11),
(977, 10, 12),
(977, 21, 13),
(977, 22, 14),
(977, 23, 15),
(977, 3, 16),
(977, 24, 17),
(977, 5, 18),
(977, 9, 19),
(977, 4, 20),
(977, 8, 21),
(977, 7, 22),
(977, 6, 23),
(977, 25, 24),
(977, 26, 25),
(977, 27, 26),
(977, 28, 27),
(977, 29, 28),
(977, 1, 29),
(977, 30, 30),
(977, 31, 31),
(977, 53, 32),
(977, 54, 33),
(977, 52, 34),
(977, 51, 35),
(977, 50, 36),
(977, 49, 37),
(977, 48, 38),
(977, 47, 39),
(977, 46, 40),
(978, 46, 1),
(978, 47, 2),
(978, 48, 3),
(978, 49, 4),
(978, 50, 5),
(978, 51, 6),
(978, 52, 7),
(978, 54, 8),
(978, 53, 9),
(978, 31, 10),
(978, 30, 11),
(978, 1, 12),
(978, 29, 13),
(978, 28, 14),
(978, 27, 15),
(978, 26, 16),
(978, 25, 17),
(978, 6, 18),
(978, 7, 19),
(978, 8, 20),
(978, 4, 21),
(978, 9, 22),
(978, 5, 23),
(978, 24, 24),
(978, 3, 25),
(978, 23, 26),
(978, 22, 27),
(978, 21, 28),
(978, 10, 29),
(978, 11, 30),
(978, 12, 31),
(978, 20, 32),
(978, 19, 33),
(978, 18, 34),
(978, 17, 35),
(978, 16, 36),
(978, 15, 37),
(978, 14, 38),
(978, 13, 39),
(978, 2, 40),
(979, 1, 1),
(979, 3, 2),
(979, 2, 3),
(979, 61, 4),
(980, 1, 1),
(980, 3, 2),
(980, 2, 3),
(980, 61, 4),
(981, 61, 1),
(981, 2, 2),
(981, 3, 3),
(981, 1, 4),
(982, 1, 1),
(982, 3, 2),
(982, 2, 3),
(982, 61, 4),
(983, 61, 1),
(983, 2, 2),
(983, 3, 3),
(983, 1, 4),
(984, 1, 1),
(984, 3, 2),
(984, 2, 3),
(984, 61, 4),
(985, 61, 1),
(985, 2, 2),
(985, 3, 3),
(985, 1, 4),
(986, 61, 1),
(986, 2, 2),
(986, 3, 3),
(986, 1, 4),
(987, 1, 1),
(987, 3, 2),
(987, 2, 3),
(987, 61, 4),
(988, 61, 1),
(988, 2, 2),
(988, 3, 3),
(988, 1, 4),
(989, 61, 1),
(989, 2, 2),
(989, 3, 3),
(989, 1, 4),
(990, 1, 1),
(990, 3, 2),
(990, 2, 3),
(990, 61, 4),
(991, 1, 1),
(991, 3, 2),
(991, 2, 3),
(991, 61, 4),
(992, 61, 1),
(992, 2, 2),
(992, 3, 3),
(992, 1, 4),
(993, 1, 1),
(993, 3, 2),
(993, 2, 3),
(993, 61, 4),
(994, 61, 1),
(994, 2, 2),
(994, 3, 3),
(994, 1, 4),
(995, 45, 1),
(995, 44, 2),
(995, 43, 3),
(995, 42, 4),
(995, 41, 5),
(995, 40, 6),
(995, 39, 7),
(995, 38, 8),
(995, 37, 9),
(995, 36, 10),
(995, 35, 11),
(995, 34, 12),
(995, 33, 13),
(995, 32, 14),
(995, 31, 15),
(995, 30, 16),
(995, 1, 17),
(995, 29, 18),
(995, 28, 19),
(995, 27, 20),
(995, 26, 21),
(995, 25, 22),
(995, 6, 23),
(995, 7, 24),
(995, 8, 25),
(995, 4, 26),
(995, 9, 27),
(995, 5, 28),
(995, 24, 29),
(995, 3, 30),
(995, 23, 31),
(995, 22, 32),
(995, 21, 33),
(995, 10, 34),
(995, 11, 35),
(995, 12, 36),
(995, 20, 37),
(995, 19, 38),
(995, 18, 39),
(995, 17, 40),
(995, 16, 41),
(995, 15, 42),
(995, 14, 43),
(995, 13, 44),
(995, 2, 45),
(996, 2, 1),
(996, 13, 2),
(996, 14, 3),
(996, 15, 4),
(996, 16, 5),
(996, 17, 6),
(996, 18, 7),
(996, 19, 8),
(996, 20, 9),
(996, 12, 10),
(996, 11, 11),
(996, 10, 12),
(996, 21, 13),
(996, 22, 14),
(996, 23, 15),
(996, 3, 16),
(996, 24, 17),
(996, 5, 18),
(996, 9, 19),
(996, 4, 20),
(996, 8, 21),
(996, 7, 22),
(996, 6, 23),
(996, 25, 24),
(996, 26, 25),
(996, 27, 26),
(996, 28, 27),
(996, 29, 28),
(996, 1, 29),
(996, 30, 30),
(996, 31, 31),
(996, 32, 32),
(996, 33, 33),
(996, 34, 34),
(996, 35, 35),
(996, 36, 36),
(996, 37, 37),
(996, 38, 38),
(996, 39, 39),
(996, 40, 40),
(996, 41, 41),
(996, 42, 42),
(996, 43, 43),
(996, 44, 44),
(996, 45, 45),
(997, 46, 1),
(997, 47, 2),
(997, 48, 3),
(997, 49, 4),
(997, 50, 5),
(997, 51, 6),
(997, 52, 7),
(997, 54, 8),
(997, 53, 9),
(997, 31, 10),
(997, 30, 11),
(997, 1, 12),
(997, 29, 13),
(997, 28, 14),
(997, 27, 15),
(997, 26, 16),
(997, 25, 17),
(997, 6, 18),
(997, 7, 19),
(997, 8, 20),
(997, 4, 21),
(997, 9, 22),
(997, 5, 23),
(997, 24, 24),
(997, 3, 25),
(997, 23, 26),
(997, 22, 27),
(997, 21, 28),
(997, 10, 29),
(997, 11, 30),
(997, 12, 31),
(997, 20, 32),
(997, 19, 33),
(997, 18, 34),
(997, 17, 35),
(997, 16, 36),
(997, 15, 37),
(997, 14, 38),
(997, 13, 39),
(997, 2, 40),
(998, 2, 1),
(998, 13, 2),
(998, 14, 3),
(998, 15, 4),
(998, 16, 5),
(998, 17, 6),
(998, 18, 7),
(998, 19, 8),
(998, 20, 9),
(998, 12, 10),
(998, 11, 11),
(998, 10, 12),
(998, 21, 13),
(998, 22, 14),
(998, 23, 15),
(998, 3, 16),
(998, 24, 17),
(998, 5, 18),
(998, 9, 19),
(998, 4, 20),
(998, 8, 21),
(998, 7, 22),
(998, 6, 23),
(998, 25, 24),
(998, 26, 25),
(998, 27, 26),
(998, 28, 27),
(998, 29, 28),
(998, 1, 29),
(998, 30, 30),
(998, 31, 31),
(998, 53, 32),
(998, 54, 33),
(998, 52, 34),
(998, 51, 35),
(998, 50, 36),
(998, 49, 37),
(998, 48, 38),
(998, 47, 39),
(998, 46, 40),
(999, 1, 1),
(999, 29, 2),
(999, 28, 3),
(999, 27, 4),
(999, 26, 5),
(999, 25, 6),
(999, 6, 7),
(999, 7, 8),
(999, 8, 9),
(999, 4, 10),
(999, 9, 11),
(999, 5, 12),
(999, 24, 13),
(999, 3, 14),
(999, 23, 15),
(999, 22, 16),
(999, 21, 17),
(999, 10, 18),
(999, 11, 19),
(999, 12, 20),
(999, 20, 21),
(999, 55, 22),
(999, 56, 23),
(999, 57, 24),
(999, 58, 25),
(999, 59, 26),
(999, 60, 27),
(999, 61, 28),
(999, 62, 29),
(999, 63, 30),
(999, 64, 31),
(999, 65, 32),
(999, 66, 33),
(999, 67, 34),
(999, 68, 35),
(999, 69, 36),
(999, 70, 37),
(999, 71, 38),
(999, 72, 39),
(999, 73, 40),
(999, 74, 41),
(999, 75, 42),
(999, 76, 43),
(999, 77, 44),
(999, 78, 45),
(999, 79, 46),
(999, 80, 47),
(1000, 80, 1),
(1000, 79, 2),
(1000, 78, 3),
(1000, 77, 4),
(1000, 76, 5),
(1000, 75, 6),
(1000, 74, 7),
(1000, 73, 8),
(1000, 72, 9),
(1000, 71, 10),
(1000, 70, 11),
(1000, 69, 12),
(1000, 68, 13),
(1000, 67, 14),
(1000, 66, 15),
(1000, 65, 16),
(1000, 64, 17),
(1000, 63, 18),
(1000, 62, 19),
(1000, 61, 20),
(1000, 60, 21),
(1000, 59, 22),
(1000, 58, 23),
(1000, 57, 24),
(1000, 56, 25),
(1000, 55, 26),
(1000, 20, 27),
(1000, 12, 28),
(1000, 11, 29),
(1000, 10, 30),
(1000, 21, 31),
(1000, 22, 32),
(1000, 23, 33),
(1000, 3, 34),
(1000, 24, 35),
(1000, 5, 36),
(1000, 9, 37),
(1000, 4, 38),
(1000, 8, 39),
(1000, 7, 40),
(1000, 6, 41),
(1000, 25, 42),
(1000, 26, 43),
(1000, 27, 44),
(1000, 28, 45),
(1000, 29, 46),
(1000, 1, 47),
(1001, 1, 1),
(1001, 29, 2),
(1001, 28, 3),
(1001, 27, 4),
(1001, 26, 5),
(1001, 25, 6),
(1001, 6, 7),
(1001, 7, 8),
(1001, 8, 9),
(1001, 4, 10),
(1001, 9, 11),
(1001, 5, 12),
(1001, 24, 13),
(1001, 3, 14),
(1001, 23, 15),
(1001, 22, 16),
(1001, 21, 17),
(1001, 10, 18),
(1001, 11, 19),
(1001, 12, 20),
(1001, 20, 21),
(1001, 55, 22),
(1001, 56, 23),
(1001, 57, 24),
(1001, 58, 25),
(1001, 59, 26),
(1001, 60, 27),
(1001, 61, 28),
(1001, 62, 29),
(1001, 63, 30),
(1001, 64, 31),
(1001, 65, 32),
(1001, 66, 33),
(1001, 67, 34),
(1001, 68, 35),
(1001, 69, 36),
(1001, 70, 37),
(1001, 71, 38),
(1001, 72, 39),
(1001, 73, 40),
(1001, 74, 41),
(1001, 75, 42),
(1001, 76, 43),
(1001, 77, 44),
(1001, 78, 45),
(1001, 79, 46),
(1001, 80, 47),
(1002, 80, 1),
(1002, 79, 2),
(1002, 78, 3),
(1002, 77, 4),
(1002, 76, 5),
(1002, 75, 6),
(1002, 74, 7),
(1002, 73, 8),
(1002, 72, 9),
(1002, 71, 10),
(1002, 70, 11),
(1002, 69, 12),
(1002, 68, 13),
(1002, 67, 14),
(1002, 66, 15),
(1002, 65, 16),
(1002, 64, 17),
(1002, 63, 18),
(1002, 62, 19),
(1002, 61, 20),
(1002, 60, 21),
(1002, 59, 22),
(1002, 58, 23),
(1002, 57, 24),
(1002, 56, 25),
(1002, 55, 26),
(1002, 20, 27),
(1002, 12, 28),
(1002, 11, 29),
(1002, 10, 30),
(1002, 21, 31),
(1002, 22, 32),
(1002, 23, 33),
(1002, 3, 34),
(1002, 24, 35),
(1002, 5, 36),
(1002, 9, 37),
(1002, 4, 38),
(1002, 8, 39),
(1002, 7, 40),
(1002, 6, 41),
(1002, 25, 42),
(1002, 26, 43),
(1002, 27, 44),
(1002, 28, 45),
(1002, 29, 46),
(1002, 1, 47),
(1003, 1, 1),
(1003, 29, 2),
(1003, 28, 3),
(1003, 27, 4),
(1003, 26, 5),
(1003, 25, 6),
(1003, 6, 7),
(1003, 7, 8),
(1003, 8, 9),
(1003, 4, 10),
(1003, 9, 11),
(1003, 5, 12),
(1003, 24, 13),
(1003, 3, 14),
(1003, 23, 15),
(1003, 22, 16),
(1003, 21, 17),
(1003, 10, 18),
(1003, 11, 19),
(1003, 12, 20),
(1003, 20, 21),
(1003, 55, 22),
(1003, 56, 23),
(1003, 57, 24),
(1003, 58, 25),
(1003, 59, 26),
(1003, 60, 27),
(1003, 61, 28),
(1003, 62, 29),
(1003, 63, 30),
(1003, 64, 31),
(1003, 65, 32),
(1003, 66, 33),
(1003, 67, 34),
(1003, 68, 35),
(1003, 69, 36),
(1003, 70, 37),
(1003, 71, 38),
(1003, 72, 39),
(1003, 73, 40),
(1003, 74, 41),
(1003, 75, 42),
(1003, 76, 43),
(1003, 77, 44),
(1003, 78, 45),
(1003, 79, 46),
(1003, 80, 47),
(1004, 80, 1),
(1004, 79, 2),
(1004, 78, 3),
(1004, 77, 4),
(1004, 76, 5),
(1004, 75, 6),
(1004, 74, 7),
(1004, 73, 8),
(1004, 72, 9),
(1004, 71, 10),
(1004, 70, 11),
(1004, 69, 12),
(1004, 68, 13),
(1004, 67, 14),
(1004, 66, 15),
(1004, 65, 16),
(1004, 64, 17),
(1004, 63, 18),
(1004, 62, 19),
(1004, 61, 20),
(1004, 60, 21),
(1004, 59, 22),
(1004, 58, 23),
(1004, 57, 24),
(1004, 56, 25),
(1004, 55, 26),
(1004, 20, 27),
(1004, 12, 28),
(1004, 11, 29),
(1004, 10, 30),
(1004, 21, 31),
(1004, 22, 32),
(1004, 23, 33),
(1004, 3, 34),
(1004, 24, 35),
(1004, 5, 36),
(1004, 9, 37),
(1004, 4, 38),
(1004, 8, 39),
(1004, 7, 40),
(1004, 6, 41),
(1004, 25, 42),
(1004, 26, 43),
(1004, 27, 44),
(1004, 28, 45),
(1004, 29, 46),
(1004, 1, 47),
(1005, 1, 1),
(1005, 29, 2),
(1005, 28, 3),
(1005, 27, 4),
(1005, 26, 5),
(1005, 25, 6),
(1005, 6, 7),
(1005, 7, 8),
(1005, 8, 9),
(1005, 4, 10),
(1005, 9, 11),
(1005, 5, 12),
(1005, 24, 13),
(1005, 3, 14),
(1005, 23, 15),
(1005, 22, 16),
(1005, 21, 17),
(1005, 10, 18),
(1005, 11, 19),
(1005, 12, 20),
(1005, 20, 21),
(1005, 55, 22),
(1005, 56, 23),
(1005, 57, 24),
(1005, 58, 25),
(1005, 59, 26),
(1005, 60, 27),
(1005, 61, 28),
(1005, 62, 29),
(1005, 63, 30),
(1005, 64, 31),
(1005, 65, 32),
(1005, 66, 33),
(1005, 67, 34),
(1005, 68, 35),
(1005, 69, 36),
(1005, 70, 37),
(1005, 71, 38),
(1005, 72, 39),
(1005, 73, 40),
(1005, 74, 41),
(1005, 75, 42),
(1005, 76, 43),
(1005, 77, 44),
(1005, 78, 45),
(1005, 79, 46),
(1005, 80, 47),
(1006, 80, 1),
(1006, 79, 2),
(1006, 78, 3),
(1006, 77, 4),
(1006, 76, 5),
(1006, 75, 6),
(1006, 74, 7),
(1006, 73, 8),
(1006, 72, 9),
(1006, 71, 10),
(1006, 70, 11),
(1006, 69, 12),
(1006, 68, 13),
(1006, 67, 14),
(1006, 66, 15),
(1006, 65, 16),
(1006, 64, 17),
(1006, 63, 18),
(1006, 62, 19),
(1006, 61, 20),
(1006, 60, 21),
(1006, 59, 22),
(1006, 58, 23),
(1006, 57, 24),
(1006, 56, 25),
(1006, 55, 26),
(1006, 20, 27),
(1006, 12, 28),
(1006, 11, 29),
(1006, 10, 30),
(1006, 21, 31),
(1006, 22, 32),
(1006, 23, 33),
(1006, 3, 34),
(1006, 24, 35),
(1006, 5, 36),
(1006, 9, 37),
(1006, 4, 38),
(1006, 8, 39),
(1006, 7, 40),
(1006, 6, 41),
(1006, 25, 42),
(1006, 26, 43),
(1006, 27, 44),
(1006, 28, 45),
(1006, 29, 46),
(1006, 1, 47),
(1007, 1, 1),
(1007, 29, 2),
(1007, 28, 3),
(1007, 27, 4),
(1007, 26, 5),
(1007, 25, 6),
(1007, 6, 7),
(1007, 7, 8),
(1007, 8, 9),
(1007, 4, 10),
(1007, 9, 11),
(1007, 5, 12),
(1007, 24, 13),
(1007, 3, 14),
(1007, 23, 15),
(1007, 22, 16),
(1007, 21, 17),
(1007, 10, 18),
(1007, 11, 19),
(1007, 12, 20),
(1007, 20, 21),
(1007, 55, 22),
(1007, 56, 23),
(1007, 57, 24),
(1007, 58, 25),
(1007, 59, 26),
(1007, 60, 27),
(1007, 61, 28),
(1007, 62, 29),
(1007, 63, 30),
(1007, 64, 31),
(1007, 65, 32),
(1007, 66, 33),
(1007, 67, 34),
(1007, 68, 35),
(1007, 69, 36),
(1007, 70, 37),
(1007, 71, 38),
(1007, 72, 39),
(1007, 73, 40),
(1007, 74, 41),
(1007, 75, 42),
(1007, 76, 43),
(1007, 77, 44),
(1007, 78, 45),
(1007, 79, 46),
(1007, 80, 47),
(1008, 80, 1),
(1008, 79, 2),
(1008, 78, 3),
(1008, 77, 4),
(1008, 76, 5),
(1008, 75, 6),
(1008, 74, 7),
(1008, 73, 8),
(1008, 72, 9),
(1008, 71, 10),
(1008, 70, 11),
(1008, 69, 12),
(1008, 68, 13),
(1008, 67, 14),
(1008, 66, 15),
(1008, 65, 16),
(1008, 64, 17),
(1008, 63, 18),
(1008, 62, 19),
(1008, 61, 20),
(1008, 60, 21),
(1008, 59, 22),
(1008, 58, 23),
(1008, 57, 24),
(1008, 56, 25),
(1008, 55, 26),
(1008, 20, 27),
(1008, 12, 28),
(1008, 11, 29),
(1008, 10, 30),
(1008, 21, 31),
(1008, 22, 32),
(1008, 23, 33),
(1008, 3, 34),
(1008, 24, 35),
(1008, 5, 36),
(1008, 9, 37),
(1008, 4, 38),
(1008, 8, 39),
(1008, 7, 40),
(1008, 6, 41),
(1008, 25, 42),
(1008, 26, 43),
(1008, 27, 44),
(1008, 28, 45),
(1008, 29, 46),
(1008, 1, 47),
(1009, 1, 1),
(1009, 29, 2),
(1009, 28, 3),
(1009, 27, 4),
(1009, 26, 5),
(1009, 25, 6),
(1009, 6, 7),
(1009, 7, 8),
(1009, 8, 9),
(1009, 4, 10),
(1009, 9, 11),
(1009, 5, 12),
(1009, 24, 13),
(1009, 3, 14),
(1009, 23, 15),
(1009, 22, 16),
(1009, 21, 17),
(1009, 10, 18),
(1009, 11, 19),
(1009, 12, 20),
(1009, 20, 21),
(1009, 55, 22),
(1009, 56, 23),
(1009, 57, 24),
(1009, 58, 25),
(1009, 59, 26),
(1009, 60, 27),
(1009, 61, 28),
(1009, 62, 29),
(1009, 63, 30),
(1009, 64, 31),
(1009, 65, 32),
(1009, 66, 33),
(1009, 67, 34),
(1009, 68, 35),
(1009, 69, 36),
(1009, 70, 37),
(1009, 71, 38),
(1009, 72, 39),
(1009, 73, 40),
(1009, 74, 41),
(1009, 75, 42),
(1009, 76, 43),
(1009, 77, 44),
(1009, 78, 45),
(1009, 79, 46),
(1009, 80, 47),
(1010, 80, 1),
(1010, 79, 2),
(1010, 78, 3),
(1010, 77, 4),
(1010, 76, 5),
(1010, 75, 6),
(1010, 74, 7),
(1010, 73, 8),
(1010, 72, 9),
(1010, 71, 10),
(1010, 70, 11),
(1010, 69, 12),
(1010, 68, 13),
(1010, 67, 14),
(1010, 66, 15),
(1010, 65, 16),
(1010, 64, 17),
(1010, 63, 18),
(1010, 62, 19),
(1010, 61, 20),
(1010, 60, 21),
(1010, 59, 22),
(1010, 58, 23),
(1010, 57, 24),
(1010, 56, 25),
(1010, 55, 26),
(1010, 20, 27),
(1010, 12, 28),
(1010, 11, 29),
(1010, 10, 30),
(1010, 21, 31),
(1010, 22, 32),
(1010, 23, 33),
(1010, 3, 34),
(1010, 24, 35),
(1010, 5, 36),
(1010, 9, 37),
(1010, 4, 38),
(1010, 8, 39),
(1010, 7, 40),
(1010, 6, 41),
(1010, 25, 42),
(1010, 26, 43),
(1010, 27, 44),
(1010, 28, 45),
(1010, 29, 46),
(1010, 1, 47),
(1011, 1, 1),
(1011, 29, 2),
(1011, 28, 3),
(1011, 27, 4),
(1011, 26, 5),
(1011, 25, 6),
(1011, 6, 7),
(1011, 7, 8),
(1011, 8, 9),
(1011, 4, 10),
(1011, 9, 11),
(1011, 5, 12),
(1011, 24, 13),
(1011, 3, 14),
(1011, 23, 15),
(1011, 22, 16),
(1011, 21, 17),
(1011, 10, 18),
(1011, 11, 19),
(1011, 12, 20),
(1011, 20, 21),
(1011, 55, 22),
(1011, 56, 23),
(1011, 57, 24),
(1011, 58, 25),
(1011, 59, 26),
(1011, 60, 27),
(1011, 61, 28),
(1011, 62, 29),
(1011, 63, 30),
(1011, 64, 31),
(1011, 65, 32),
(1011, 66, 33),
(1011, 67, 34),
(1011, 68, 35),
(1011, 69, 36),
(1011, 70, 37),
(1011, 71, 38),
(1011, 72, 39),
(1011, 73, 40),
(1011, 74, 41),
(1011, 75, 42),
(1011, 76, 43),
(1011, 77, 44),
(1011, 78, 45),
(1011, 79, 46),
(1011, 80, 47),
(1012, 80, 1),
(1012, 79, 2),
(1012, 78, 3),
(1012, 77, 4),
(1012, 76, 5),
(1012, 75, 6),
(1012, 74, 7),
(1012, 73, 8),
(1012, 72, 9),
(1012, 71, 10),
(1012, 70, 11),
(1012, 69, 12),
(1012, 68, 13),
(1012, 67, 14),
(1012, 66, 15),
(1012, 65, 16),
(1012, 64, 17),
(1012, 63, 18),
(1012, 62, 19),
(1012, 61, 20),
(1012, 60, 21),
(1012, 59, 22),
(1012, 58, 23),
(1012, 57, 24),
(1012, 56, 25),
(1012, 55, 26),
(1012, 20, 27),
(1012, 12, 28),
(1012, 11, 29),
(1012, 10, 30),
(1012, 21, 31),
(1012, 22, 32),
(1012, 23, 33),
(1012, 3, 34),
(1012, 24, 35),
(1012, 5, 36),
(1012, 9, 37),
(1012, 4, 38),
(1012, 8, 39),
(1012, 7, 40),
(1012, 6, 41),
(1012, 25, 42),
(1012, 26, 43),
(1012, 27, 44),
(1012, 28, 45),
(1012, 29, 46),
(1012, 1, 47);

-- --------------------------------------------------------

--
-- Table structure for table `trip_vehicles`
--

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
(731, 731, 1, 1),
(732, 732, 1, 1),
(733, 733, 1, 1),
(734, 734, 1, 1),
(735, 735, 1, 1),
(736, 736, 2, 1),
(737, 737, 1, 1),
(738, 738, 1, 1),
(739, 739, 1, 1),
(740, 740, 1, 1),
(741, 741, 1, 1),
(742, 742, 2, 1),
(743, 743, 1, 1),
(744, 744, 1, 1),
(745, 745, 1, 1),
(746, 746, 1, 1),
(747, 747, 1, 1),
(748, 748, 2, 1),
(749, 749, 1, 1),
(750, 750, 1, 1),
(751, 751, 1, 1),
(752, 752, 1, 1),
(753, 753, 1, 1),
(754, 754, 2, 1),
(755, 755, 1, 1),
(756, 756, 1, 1),
(757, 757, 1, 1),
(758, 758, 1, 1),
(759, 759, 1, 1),
(760, 760, 2, 1),
(761, 761, 1, 1),
(762, 762, 1, 1),
(763, 763, 1, 1),
(764, 764, 1, 1),
(765, 765, 1, 1),
(766, 766, 2, 1),
(767, 767, 1, 1),
(768, 768, 1, 1),
(769, 769, 1, 1),
(770, 770, 1, 1),
(771, 771, 1, 1),
(772, 772, 2, 1),
(773, 773, 1, 1),
(774, 774, 1, 1),
(775, 775, 1, 1),
(776, 776, 1, 1),
(777, 777, 1, 1),
(778, 778, 2, 1),
(779, 779, 1, 1),
(780, 780, 1, 1),
(781, 781, 1, 1),
(782, 782, 1, 1),
(783, 783, 1, 1),
(784, 784, 2, 1),
(785, 785, 1, 1),
(786, 786, 1, 1),
(787, 787, 1, 1),
(788, 788, 1, 1),
(789, 789, 1, 1),
(804, 804, 1, 1),
(805, 805, 1, 1),
(806, 806, 1, 1),
(807, 807, 1, 1),
(808, 808, 1, 1),
(809, 809, 1, 1),
(810, 810, 1, 1),
(811, 811, 1, 1),
(812, 812, 1, 1),
(813, 813, 1, 1),
(814, 814, 1, 1),
(815, 815, 1, 1),
(816, 816, 1, 1),
(817, 817, 1, 1),
(818, 818, 2, 1),
(819, 819, 2, 1),
(820, 821, 2, 1),
(821, 822, 1, 1),
(822, 823, 2, 1),
(823, 824, 1, 1),
(824, 830, 1, 1),
(825, 838, 2, 1),
(826, 839, 2, 1),
(827, 840, 1, 1),
(828, 841, 2, 1),
(829, 842, 2, 1),
(830, 843, 1, 1),
(831, 844, 2, 1),
(832, 845, 1, 1),
(833, 846, 2, 1),
(834, 847, 2, 1),
(835, 848, 1, 1),
(836, 849, 2, 1),
(837, 850, 1, 1),
(838, 851, 2, 1),
(839, 852, 1, 1),
(840, 853, 2, 1),
(841, 854, 1, 1),
(842, 855, 1, 1),
(843, 856, 1, 1),
(844, 857, 1, 1),
(845, 858, 2, 1),
(846, 859, 2, 1),
(847, 860, 1, 1),
(848, 861, 2, 1),
(849, 862, 2, 1),
(850, 863, 1, 1),
(851, 864, 2, 1),
(852, 865, 1, 1),
(853, 866, 2, 1),
(854, 867, 2, 1),
(855, 868, 1, 1),
(856, 869, 2, 1),
(857, 870, 1, 1),
(858, 871, 2, 1),
(859, 872, 1, 1),
(860, 873, 2, 1),
(861, 874, 1, 1),
(862, 875, 1, 1),
(863, 876, 1, 1),
(864, 877, 1, 1),
(865, 878, 2, 1),
(866, 879, 2, 1),
(867, 880, 1, 1),
(868, 881, 2, 1),
(869, 882, 2, 1),
(870, 883, 1, 1),
(871, 884, 2, 1),
(872, 885, 1, 1),
(873, 886, 2, 1),
(874, 887, 2, 1),
(875, 888, 1, 1),
(876, 889, 2, 1),
(877, 890, 1, 1),
(878, 891, 2, 1),
(879, 892, 1, 1),
(880, 893, 2, 1),
(881, 894, 1, 1),
(882, 895, 1, 1),
(883, 896, 1, 1),
(884, 897, 1, 1),
(885, 898, 2, 1),
(886, 899, 2, 1),
(887, 900, 1, 1),
(888, 901, 2, 1),
(889, 902, 2, 1),
(890, 903, 1, 1),
(891, 904, 2, 1),
(892, 905, 1, 1),
(893, 906, 2, 1),
(894, 907, 2, 1),
(895, 908, 1, 1),
(896, 909, 2, 1),
(897, 910, 1, 1),
(898, 911, 2, 1),
(899, 912, 1, 1),
(900, 913, 2, 1),
(901, 914, 1, 1),
(902, 915, 1, 1),
(903, 916, 1, 1),
(904, 917, 1, 1),
(905, 918, 2, 1),
(906, 919, 2, 1),
(907, 920, 1, 1),
(908, 921, 2, 1),
(909, 922, 2, 1),
(910, 923, 1, 1),
(911, 924, 2, 1),
(912, 925, 1, 1),
(913, 926, 2, 1),
(914, 927, 2, 1),
(915, 928, 1, 1),
(916, 929, 2, 1),
(917, 930, 1, 1),
(918, 931, 2, 1),
(919, 932, 1, 1),
(920, 933, 2, 1),
(921, 934, 1, 1),
(922, 935, 1, 1),
(923, 936, 1, 1),
(924, 937, 1, 1),
(925, 938, 2, 1),
(926, 939, 2, 1),
(927, 940, 1, 1),
(928, 941, 2, 1),
(929, 942, 2, 1),
(930, 943, 1, 1),
(931, 944, 2, 1),
(932, 945, 1, 1),
(933, 946, 2, 1),
(934, 947, 2, 1),
(935, 948, 1, 1),
(936, 949, 2, 1),
(937, 950, 1, 1),
(938, 951, 2, 1),
(939, 952, 1, 1),
(940, 953, 2, 1),
(941, 954, 1, 1),
(942, 955, 1, 1),
(943, 956, 1, 1),
(944, 957, 1, 1),
(945, 958, 2, 1),
(946, 959, 2, 1),
(947, 960, 1, 1),
(948, 961, 2, 1),
(949, 962, 2, 1),
(950, 963, 1, 1),
(951, 964, 2, 1),
(952, 965, 1, 1),
(953, 966, 2, 1),
(954, 967, 2, 1),
(955, 968, 1, 1),
(956, 969, 2, 1),
(957, 970, 1, 1),
(958, 971, 2, 1),
(959, 972, 1, 1),
(960, 973, 2, 1),
(961, 974, 1, 1),
(962, 975, 1, 1),
(963, 976, 1, 1),
(964, 977, 1, 1),
(965, 978, 1, 1),
(966, 979, 2, 1),
(967, 980, 2, 1),
(968, 981, 1, 1),
(969, 982, 2, 1),
(970, 983, 2, 1),
(971, 984, 1, 1),
(972, 985, 2, 1),
(973, 986, 1, 1),
(974, 987, 2, 1),
(975, 988, 2, 1),
(976, 989, 1, 1),
(977, 990, 2, 1),
(978, 991, 1, 1),
(979, 992, 2, 1),
(980, 993, 1, 1),
(981, 994, 2, 1),
(982, 995, 1, 1),
(983, 996, 1, 1),
(984, 997, 1, 1),
(985, 998, 1, 1),
(986, 999, 1, 1),
(987, 1000, 1, 1),
(988, 1001, 1, 1),
(989, 1002, 1, 1),
(990, 1003, 1, 1),
(991, 1004, 1, 1),
(992, 1005, 1, 1),
(993, 1006, 1, 1),
(994, 1007, 1, 1),
(995, 1008, 1, 1),
(996, 1009, 1, 1),
(997, 1010, 1, 1),
(998, 1011, 1, 1),
(999, 1012, 1, 1);

-- --------------------------------------------------------

--
-- Table structure for table `trip_vehicle_employees`
--

CREATE TABLE `trip_vehicle_employees` (
  `id` int(11) NOT NULL,
  `trip_vehicle_id` int(11) DEFAULT NULL,
  `employee_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_preferences`
--

CREATE TABLE `user_preferences` (
  `user_id` bigint(20) NOT NULL,
  `prefs_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT json_object() CHECK (json_valid(`prefs_json`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_route_order`
--

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
-- Indexes for table `discount_types`
--
ALTER TABLE `discount_types`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `employees`
--
ALTER TABLE `employees`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_employees_role` (`role`);

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
-- Indexes for table `public_users`
--
ALTER TABLE `public_users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_public_users_email_norm` (`email_normalized`),
  ADD UNIQUE KEY `uniq_public_users_google` (`google_sub`),
  ADD UNIQUE KEY `uniq_public_users_apple` (`apple_sub`),
  ADD KEY `idx_public_users_phone_norm` (`phone_normalized`);

--
-- Indexes for table `public_user_phone_links`
--
ALTER TABLE `public_user_phone_links`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_public_phone_request` (`request_token`),
  ADD KEY `idx_public_phone_user` (`user_id`),
  ADD KEY `idx_public_phone_person` (`person_id`),
  ADD KEY `idx_public_phone_status` (`status`),
  ADD KEY `idx_public_phone_normalized` (`normalized_phone`);

--
-- Indexes for table `public_user_sessions`
--
ALTER TABLE `public_user_sessions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_public_sessions_hash` (`token_hash`),
  ADD KEY `idx_public_sessions_user` (`user_id`),
  ADD KEY `idx_public_sessions_expires` (`expires_at`);

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
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=36;

--
-- AUTO_INCREMENT for table `discount_types`
--
ALTER TABLE `discount_types`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `employees`
--
ALTER TABLE `employees`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `idempotency_keys`
--
ALTER TABLE `idempotency_keys`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `invitations`
--
ALTER TABLE `invitations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

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
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `people`
--
ALTER TABLE `people`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `price_lists`
--
ALTER TABLE `price_lists`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `price_list_items`
--
ALTER TABLE `price_list_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6813;

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
-- AUTO_INCREMENT for table `public_users`
--
ALTER TABLE `public_users`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `public_user_phone_links`
--
ALTER TABLE `public_user_phone_links`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `public_user_sessions`
--
ALTER TABLE `public_user_sessions`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `reservations`
--
ALTER TABLE `reservations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=33;

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
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=241;

--
-- AUTO_INCREMENT for table `routes`
--
ALTER TABLE `routes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `route_schedules`
--
ALTER TABLE `route_schedules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=29;

--
-- AUTO_INCREMENT for table `route_stations`
--
ALTER TABLE `route_stations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=201;

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
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=23;

--
-- AUTO_INCREMENT for table `stations`
--
ALTER TABLE `stations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=81;

--
-- AUTO_INCREMENT for table `traveler_defaults`
--
ALTER TABLE `traveler_defaults`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `trips`
--
ALTER TABLE `trips`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1013;

--
-- AUTO_INCREMENT for table `trip_vehicles`
--
ALTER TABLE `trip_vehicles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1000;

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
-- Constraints for table `public_user_phone_links`
--
ALTER TABLE `public_user_phone_links`
  ADD CONSTRAINT `fk_public_phone_person` FOREIGN KEY (`person_id`) REFERENCES `people` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_public_phone_user` FOREIGN KEY (`user_id`) REFERENCES `public_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `public_user_sessions`
--
ALTER TABLE `public_user_sessions`
  ADD CONSTRAINT `fk_public_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `public_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

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
-- Constraints for table `trip_stations`
--
ALTER TABLE `trip_stations`
  ADD CONSTRAINT `fk_ts_station` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_ts_trip` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

DELIMITER $$
--
-- Events
--
CREATE DEFINER=`priscomr`@`localhost` EVENT `ev_cleanup_reservation_intents` ON SCHEDULE EVERY 1 MINUTE STARTS '2025-10-29 19:18:35' ON COMPLETION NOT PRESERVE ENABLE DO DELETE FROM reservation_intents WHERE expires_at <= NOW()$$

DELIMITER ;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
