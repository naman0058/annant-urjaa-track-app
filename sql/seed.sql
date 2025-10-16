INSERT INTO admins (name, email, password_hash, role)
VALUES ('Super Admin', 'admin@myapp.test', '$2b$10$9bH5n6x9w2q8hVt9uXq0/O0v0QmS3wGEH1oI4i2pD4qf8kW6n9w6W', 'super'); -- password: admin123

INSERT INTO users (name, email) VALUES
('Aarav Sharma', 'aarav@example.com'),
('Isha Patel', 'isha@example.com'),
('Rahul Verma', 'rahul@example.com'),
('Neha Gupta', 'neha@example.com');

INSERT INTO subscriptions (user_id, track, status, start_date, end_date) VALUES
(1, 'Gold Plan', 'active', DATE_SUB(CURDATE(), INTERVAL 10 DAY), DATE_ADD(CURDATE(), INTERVAL 20 DAY)),
(2, 'Silver Plan', 'expired', DATE_SUB(CURDATE(), INTERVAL 40 DAY), DATE_SUB(CURDATE(), INTERVAL 5 DAY)),
(3, 'Platinum Plan', 'active', DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_ADD(CURDATE(), INTERVAL 28 DAY));

INSERT INTO transactions (order_id, payment_id, receipt, email, amount, status, method, created_at) VALUES
('order_001', 'pay_001', 'rcpt_001', 'aarav@example.com', 49900, 'captured', 'upi', DATE_SUB(NOW(), INTERVAL 25 DAY)),
('order_002', 'pay_002', 'rcpt_002', 'isha@example.com', 99900, 'captured', 'card', DATE_SUB(NOW(), INTERVAL 58 DAY)),
('order_003', NULL, 'rcpt_003', 'rahul@example.com', 199900, 'created', 'card', DATE_SUB(NOW(), INTERVAL 6 DAY)),
('order_004', 'pay_004', 'rcpt_004', 'neha@example.com', 299900, 'captured', 'netbanking', NOW());

INSERT INTO categories (name, slug) VALUES
('Meditation', 'meditation'),
('Productivity', 'productivity');

INSERT INTO tracks (category_id, title, description, price_paise, status) VALUES
(1, 'Morning Calm', 'Gentle breathing session', 9900, 'active'),
(2, 'Focus Boost', 'Lo-fi focus track', 14900, 'active');