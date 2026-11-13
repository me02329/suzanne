--
-- PostgreSQL database dump
--

\restrict FGlFndCV1AzmPTDVWDu3e9VRHK4jn2dyyip1raxqC4BQOXNQofonoOzuKRu5VYq

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: AccountType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AccountType" AS ENUM (
    'checking',
    'savings',
    'cash',
    'other',
    'livret_a',
    'ldds',
    'lep',
    'pel',
    'cel',
    'pea',
    'securities',
    'life_insurance',
    'crypto',
    'retirement',
    'credit',
    'loan'
);


--
-- Name: AlertOperator; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AlertOperator" AS ENUM (
    'lt',
    'gt'
);


--
-- Name: AlertType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AlertType" AS ENUM (
    'account_balance',
    'transaction_amount',
    'stale_snapshot',
    'goal_behind'
);


--
-- Name: AssetClass; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AssetClass" AS ENUM (
    'equity',
    'etf',
    'fund',
    'bond',
    'crypto',
    'commodity',
    'cash',
    'other'
);


--
-- Name: BillFrequency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."BillFrequency" AS ENUM (
    'monthly',
    'yearly'
);


--
-- Name: CategoryType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CategoryType" AS ENUM (
    'expense',
    'income'
);


--
-- Name: OrderSide; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OrderSide" AS ENUM (
    'buy',
    'sell'
);


--
-- Name: RecurringFrequency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RecurringFrequency" AS ENUM (
    'weekly',
    'monthly',
    'yearly'
);


--
-- Name: TransactionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TransactionType" AS ENUM (
    'expense',
    'income',
    'transfer'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: account_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_snapshots (
    id integer NOT NULL,
    user_id integer NOT NULL,
    account_id integer NOT NULL,
    date date NOT NULL,
    balance double precision NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: account_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.account_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: account_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.account_snapshots_id_seq OWNED BY public.account_snapshots.id;


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    type public."AccountType" NOT NULL,
    currency text DEFAULT 'EUR'::text NOT NULL,
    initial_balance double precision DEFAULT 0 NOT NULL,
    initial_balance_date date NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    institution_id integer,
    archived boolean DEFAULT false NOT NULL
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type public."AlertType" NOT NULL,
    account_id integer,
    goal_id integer,
    operator public."AlertOperator",
    threshold double precision,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alerts_id_seq OWNED BY public.alerts.id;


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    id integer NOT NULL,
    user_id integer NOT NULL,
    transaction_id integer NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    size integer NOT NULL,
    data bytea NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attachments_id_seq OWNED BY public.attachments.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    user_id integer,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id integer,
    status integer NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backups (
    id integer NOT NULL,
    user_id integer,
    label text NOT NULL,
    size integer NOT NULL,
    auto boolean DEFAULT false NOT NULL,
    data bytea NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: backups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.backups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: backups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.backups_id_seq OWNED BY public.backups.id;


--
-- Name: bill_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_matches (
    id integer NOT NULL,
    user_id integer NOT NULL,
    bill_id integer NOT NULL,
    transaction_id integer NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: bill_matches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_matches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_matches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_matches_id_seq OWNED BY public.bill_matches.id;


--
-- Name: bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bills (
    id integer NOT NULL,
    user_id integer NOT NULL,
    account_id integer,
    category_id integer,
    name text NOT NULL,
    amount_min double precision NOT NULL,
    amount_max double precision NOT NULL,
    start_date date NOT NULL,
    frequency public."BillFrequency" DEFAULT 'monthly'::public."BillFrequency" NOT NULL,
    "interval" integer DEFAULT 1 NOT NULL,
    pattern text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: bills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bills_id_seq OWNED BY public.bills.id;


--
-- Name: budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budgets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    category_id integer NOT NULL,
    month text NOT NULL,
    amount_limit double precision NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    recurring boolean DEFAULT false NOT NULL,
    rollover boolean DEFAULT false NOT NULL
);


--
-- Name: budgets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budgets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budgets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budgets_id_seq OWNED BY public.budgets.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    type public."CategoryType" NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    icon text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: category_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_rules (
    id integer NOT NULL,
    user_id integer NOT NULL,
    pattern text NOT NULL,
    category_id integer NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: category_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.category_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: category_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.category_rules_id_seq OWNED BY public.category_rules.id;


--
-- Name: exchange_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rates (
    id integer NOT NULL,
    base character varying(3) NOT NULL,
    quote character varying(3) NOT NULL,
    date date NOT NULL,
    rate double precision NOT NULL,
    as_of date,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: exchange_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exchange_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exchange_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exchange_rates_id_seq OWNED BY public.exchange_rates.id;


--
-- Name: goal_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_contributions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    goal_id integer NOT NULL,
    transaction_id integer,
    amount double precision NOT NULL,
    date date NOT NULL,
    description text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: goal_contributions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.goal_contributions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: goal_contributions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.goal_contributions_id_seq OWNED BY public.goal_contributions.id;


--
-- Name: holding_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holding_orders (
    id integer NOT NULL,
    user_id integer NOT NULL,
    holding_id integer NOT NULL,
    side public."OrderSide" NOT NULL,
    date date NOT NULL,
    quantity double precision NOT NULL,
    unit_price double precision NOT NULL,
    fee double precision DEFAULT 0 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: holding_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.holding_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: holding_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.holding_orders_id_seq OWNED BY public.holding_orders.id;


--
-- Name: holdings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holdings (
    id integer NOT NULL,
    user_id integer NOT NULL,
    account_id integer NOT NULL,
    symbol text NOT NULL,
    name text NOT NULL,
    asset_class public."AssetClass" DEFAULT 'equity'::public."AssetClass" NOT NULL,
    currency text DEFAULT 'EUR'::text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: holdings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.holdings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: holdings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.holdings_id_seq OWNED BY public.holdings.id;


--
-- Name: import_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_mappings (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    date_format text DEFAULT 'auto'::text NOT NULL,
    columns jsonb NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: import_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_mappings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: import_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_mappings_id_seq OWNED BY public.import_mappings.id;


--
-- Name: institutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.institutions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: institutions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.institutions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: institutions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.institutions_id_seq OWNED BY public.institutions.id;


--
-- Name: market_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_data (
    id integer NOT NULL,
    symbol text NOT NULL,
    date date NOT NULL,
    price double precision NOT NULL,
    currency text,
    as_of date,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: market_data_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.market_data_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: market_data_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.market_data_id_seq OWNED BY public.market_data.id;


--
-- Name: recurring_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_transactions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    account_id integer,
    category_id integer,
    amount double precision NOT NULL,
    type public."TransactionType" NOT NULL,
    description text NOT NULL,
    frequency public."RecurringFrequency" NOT NULL,
    day_of_month integer,
    active boolean DEFAULT true NOT NULL,
    last_executed date,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "interval" integer DEFAULT 1 NOT NULL,
    month_of_year integer,
    end_date date
);


--
-- Name: recurring_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recurring_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recurring_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recurring_transactions_id_seq OWNED BY public.recurring_transactions.id;


--
-- Name: refund_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_allocations (
    id integer NOT NULL,
    user_id integer NOT NULL,
    refund_transaction_id integer NOT NULL,
    expense_transaction_id integer NOT NULL,
    amount double precision NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: refund_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.refund_allocations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refund_allocations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.refund_allocations_id_seq OWNED BY public.refund_allocations.id;


--
-- Name: savings_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.savings_goals (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    target_amount double precision NOT NULL,
    current_amount double precision DEFAULT 0 NOT NULL,
    deadline date,
    color text DEFAULT '#4f46e5'::text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    account_id integer
);


--
-- Name: savings_goals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.savings_goals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: savings_goals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.savings_goals_id_seq OWNED BY public.savings_goals.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tags_id_seq OWNED BY public.tags.id;


--
-- Name: transaction_splits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_splits (
    id integer NOT NULL,
    user_id integer NOT NULL,
    transaction_id integer NOT NULL,
    category_id integer NOT NULL,
    amount double precision NOT NULL,
    note text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: transaction_splits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_splits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_splits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_splits_id_seq OWNED BY public.transaction_splits.id;


--
-- Name: transaction_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_tags (
    transaction_id integer NOT NULL,
    tag_id integer NOT NULL
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    account_id integer,
    category_id integer,
    amount double precision NOT NULL,
    type public."TransactionType" NOT NULL,
    date date NOT NULL,
    description text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    to_account_id integer,
    to_amount double precision,
    exchange_rate double precision,
    recurring_transaction_id integer,
    refunds_transaction_id integer,
    cleared boolean DEFAULT false NOT NULL,
    deleted_at timestamp(6) with time zone
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: account_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_snapshots ALTER COLUMN id SET DEFAULT nextval('public.account_snapshots_id_seq'::regclass);


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts ALTER COLUMN id SET DEFAULT nextval('public.alerts_id_seq'::regclass);


--
-- Name: attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments ALTER COLUMN id SET DEFAULT nextval('public.attachments_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: backups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups ALTER COLUMN id SET DEFAULT nextval('public.backups_id_seq'::regclass);


--
-- Name: bill_matches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_matches ALTER COLUMN id SET DEFAULT nextval('public.bill_matches_id_seq'::regclass);


--
-- Name: bills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills ALTER COLUMN id SET DEFAULT nextval('public.bills_id_seq'::regclass);


--
-- Name: budgets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets ALTER COLUMN id SET DEFAULT nextval('public.budgets_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: category_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_rules ALTER COLUMN id SET DEFAULT nextval('public.category_rules_id_seq'::regclass);


--
-- Name: exchange_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates ALTER COLUMN id SET DEFAULT nextval('public.exchange_rates_id_seq'::regclass);


--
-- Name: goal_contributions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_contributions ALTER COLUMN id SET DEFAULT nextval('public.goal_contributions_id_seq'::regclass);


--
-- Name: holding_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holding_orders ALTER COLUMN id SET DEFAULT nextval('public.holding_orders_id_seq'::regclass);


--
-- Name: holdings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holdings ALTER COLUMN id SET DEFAULT nextval('public.holdings_id_seq'::regclass);


--
-- Name: import_mappings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_mappings ALTER COLUMN id SET DEFAULT nextval('public.import_mappings_id_seq'::regclass);


--
-- Name: institutions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutions ALTER COLUMN id SET DEFAULT nextval('public.institutions_id_seq'::regclass);


--
-- Name: market_data id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data ALTER COLUMN id SET DEFAULT nextval('public.market_data_id_seq'::regclass);


--
-- Name: recurring_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions ALTER COLUMN id SET DEFAULT nextval('public.recurring_transactions_id_seq'::regclass);


--
-- Name: refund_allocations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_allocations ALTER COLUMN id SET DEFAULT nextval('public.refund_allocations_id_seq'::regclass);


--
-- Name: savings_goals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_goals ALTER COLUMN id SET DEFAULT nextval('public.savings_goals_id_seq'::regclass);


--
-- Name: tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags ALTER COLUMN id SET DEFAULT nextval('public.tags_id_seq'::regclass);


--
-- Name: transaction_splits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_splits ALTER COLUMN id SET DEFAULT nextval('public.transaction_splits_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
560f0200-dfdd-4d38-9641-cfcfcd70eeaa	98a9dfa94a58bcbe99621edcf911946984acef5f39949ad659d5c72c24a76f58	2026-11-13 01:41:00.368904+00	20260623203056_add_budget_rollover	\N	\N	2026-11-13 01:41:00.35624+00	1
52eb2f51-920a-4f39-8239-d4914b87fa5b	40e6909fbe526930d83bdc5db650f1c994e5f738c959a7a197088d89170b6899	2026-11-13 01:40:59.060363+00	20260524170000_init	\N	\N	2026-11-13 01:40:58.802733+00	1
e7ef5ae6-cb98-4e60-aa71-b076750a0f24	4b84a35123737296fcfb6899fef50210389b7c16c566ab65705ee7f010585b13	2026-11-13 01:40:59.854932+00	20260610203000_refund_allocations	\N	\N	2026-11-13 01:40:59.788719+00	1
932b96cf-c2b7-4183-9e3c-7cb052f14842	38c90b5f9bbeacabed68d89d6c223014a01c9f63b34ff00bbaa49540657717fa	2026-11-13 01:40:59.232092+00	20260524183000_daily_features	\N	\N	2026-11-13 01:40:59.065179+00	1
0ccf0a98-0ad4-4d8b-a6ed-6ba114854ecb	c6f6486039b88d3916d358bda4002d1ba38ddf93e1a83434c8ddc898eb729c13	2026-11-13 01:40:59.453901+00	20260526120000_transfers_and_enums	\N	\N	2026-11-13 01:40:59.237011+00	1
f021d2e0-8549-40d1-8e08-aebfa03ac53f	c58d5327087146ea9a6f66643a5970972b8794610871f823345c8f2c8b2352c6	2026-11-13 01:40:59.471716+00	20260526224500_recurring_interval	\N	\N	2026-11-13 01:40:59.458558+00	1
067d78e2-fd64-478c-8a1f-fffc8b90973e	12c69a2f6e841982e9a895bd18c66aadd7360328976448231ea3138cefe9a61c	2026-11-13 01:40:59.980356+00	20260610221622_bills_goal_contributions_cleared	\N	\N	2026-11-13 01:40:59.858835+00	1
31ee92a5-b870-40fb-a49b-541d2812b461	48d0de4b432c8fff668431887ffea9df18b39ff0db84223664796468755f1308	2026-11-13 01:40:59.516728+00	20260527091500_expand_account_types	\N	\N	2026-11-13 01:40:59.475934+00	1
4e4c266d-2de3-4913-9f95-adb14b73b79f	83f0525c9e5d433e4b805dc1f77dd2954a9e6ba6d8a3bd5f8b652e6ddbdd6b74	2026-11-13 01:40:59.533561+00	20260527100000_multi_currency_transfers	\N	\N	2026-11-13 01:40:59.520257+00	1
b236bc44-bb5e-4862-8e4d-523088aea81f	67a4b79a929b54c74ed8562c2cfe1c59324f9b16d21eab1110d527efcd77cb65	2026-11-13 01:40:59.559855+00	20260527103000_link_transactions_to_recurring	\N	\N	2026-11-13 01:40:59.53712+00	1
a833cfb5-9e3d-4f6c-bc0d-8fe095ac2325	63f9253afb83538168b2e28bd002f7b4312588369ec981c4ed41eaab91db848f	2026-11-13 01:40:59.998471+00	20260618163839_account_archived	\N	\N	2026-11-13 01:40:59.98553+00	1
51682c9d-778c-4851-8c30-502716931060	12ade5a4e31882242d47e5ea3ca93c62507a2d2ba64922e38c6301f0f452de3c	2026-11-13 01:40:59.585401+00	20260528120000_link_goals_to_accounts	\N	\N	2026-11-13 01:40:59.563182+00	1
bf8ee8ba-d4aa-481a-ab26-452bbe1d0e31	a05c9c85be4ff5b079e51d16134614782acee5ac77e87b25c5f176bbc95c50f0	2026-11-13 01:40:59.611148+00	20260528150000_settings_table	\N	\N	2026-11-13 01:40:59.588736+00	1
9d0cc08f-269a-4e05-84a7-2a3b42af52f8	ddb1b33b6e822408540c6252ab2106222456e8dfc6f07fc0b34aa7740ca40284	2026-11-13 01:41:00.430248+00	20260623204148_add_attachments	\N	\N	2026-11-13 01:41:00.372786+00	1
eb667753-1a9a-44a4-b770-5e4907eb6b62	401913e25b7366feb02a327dcad6669dfc8e4dbb4910796f60747c5886a2d57d	2026-11-13 01:40:59.680444+00	20260528170000_tags	\N	\N	2026-11-13 01:40:59.614693+00	1
7da2cc94-4767-47e0-89ad-fe795d1994c2	6dc1b52d878fe4b58b61cc5f552abd93265aeef7eba6179cbb8e8119084b398a	2026-11-13 01:41:00.017145+00	20260618170127_recurring_end_date	\N	\N	2026-11-13 01:41:00.00285+00	1
b079a315-c734-4f18-88fc-2e35c5682aa5	59c42b8dddec3e6553c92fa1420411de50c9409a22ef5c9fcfc38c93060a692f	2026-11-13 01:40:59.694273+00	20260531120000_recurring_month_of_year	\N	\N	2026-11-13 01:40:59.683896+00	1
37e81192-276b-44b3-8833-592dd718d82f	573e6f4122f6e9ae7cfb972f408472dbc36bd308ea0f56b05a409414b534f3ff	2026-11-13 01:40:59.719662+00	20260610170543_transaction_refunds	\N	\N	2026-11-13 01:40:59.69768+00	1
efac44e7-6b58-4a59-8b19-bcaf0dbe4e3c	da99476c88b14a945d7f4c63cba1b42e176aec6c3423ff8f9ec868b229661e0a	2026-11-13 01:40:59.785075+00	20260610190000_transaction_splits_recurring_budgets	\N	\N	2026-11-13 01:40:59.723195+00	1
1dc7020d-82c4-4bc2-9b4f-be0744804fb0	18bcdee41d097dd0b2486ed0dd496048de0096a7b8950016f7cf78177942d314	2026-11-13 01:41:00.089916+00	20260618170507_bill_matches	\N	\N	2026-11-13 01:41:00.022971+00	1
37355e75-9462-488a-a463-c7ab0c07816c	ee5402a2467820060f655d707d402a7b430b9df7d4d46c69fa7f7f059544d905	2026-11-13 01:41:00.125173+00	20260623173615_add_exchange_rate_cache	\N	\N	2026-11-13 01:41:00.094472+00	1
c13f10bc-4a97-4168-9518-98486ea816b5	36467f31d6779944b27e4808b54c5cc588781c86c66afbb9739b25cc9cbb7ae5	2026-11-13 01:41:00.494291+00	20260623205313_add_import_mappings	\N	\N	2026-11-13 01:41:00.43514+00	1
bb7fa41c-1f45-4f6a-840a-bc9f2bb639b0	a3412082aa80a569315f67915b3efb01b03cd3f95487fc80b2cbaafd64619bc7	2026-11-13 01:41:00.286518+00	20260623174159_add_holdings_market_data	\N	\N	2026-11-13 01:41:00.129901+00	1
499cc8f2-3619-4820-aa1a-88c8fc3d7091	601e302181bb901ede31db2af66aecc239741c5419ec25da55f0b529838c1790	2026-11-13 01:41:00.351488+00	20260623201341_add_alerts	\N	\N	2026-11-13 01:41:00.292117+00	1
520d4b16-21a8-4326-b591-157d390333b8	e089435c9214d23bec9d88a42a10d49d2ab57247421d87f0dd18bdbb67c10d9d	2026-11-13 01:41:00.588324+00	20260623210252_add_robustness	\N	\N	2026-11-13 01:41:00.499607+00	1
\.


--
-- Data for Name: account_snapshots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.account_snapshots (id, user_id, account_id, date, balance, created_at) FROM stdin;
1	1	3	2026-03-31	5600	2026-11-13 01:41:06.353+00
\.


--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.accounts (id, user_id, name, type, currency, initial_balance, initial_balance_date, created_at, institution_id, archived) FROM stdin;
1	1	Compte courant	checking	EUR	0	2026-11-13	2026-11-13 01:41:05.45+00	\N	f
2	1	G Courant	checking	EUR	1000	2026-01-01	2026-11-13 01:41:05.486+00	\N	f
3	1	G Livret	savings	EUR	5000	2026-01-01	2026-11-13 01:41:05.499+00	\N	f
4	1	G Carte	credit	EUR	0	2026-01-01	2026-11-13 01:41:05.521+00	\N	f
5	1	G Espèces	cash	EUR	0	2026-03-01	2026-11-13 01:41:05.532+00	\N	f
\.


--
-- Data for Name: alerts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.alerts (id, user_id, type, account_id, goal_id, operator, threshold, active, created_at) FROM stdin;
\.


--
-- Data for Name: attachments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.attachments (id, user_id, transaction_id, filename, mime_type, size, data, created_at) FROM stdin;
\.


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_log (id, user_id, action, entity, entity_id, status, created_at) FROM stdin;
1	\N	POST	users	\N	201	2026-11-13 01:41:05.476+00
2	1	POST	accounts	\N	201	2026-11-13 01:41:05.493+00
3	1	POST	accounts	\N	201	2026-11-13 01:41:05.516+00
4	1	POST	accounts	\N	201	2026-11-13 01:41:05.526+00
5	1	POST	accounts	\N	201	2026-11-13 01:41:05.537+00
6	1	POST	categories	\N	201	2026-11-13 01:41:05.548+00
7	1	POST	categories	\N	201	2026-11-13 01:41:05.556+00
8	1	POST	categories	\N	201	2026-11-13 01:41:05.564+00
9	1	POST	categories	\N	201	2026-11-13 01:41:05.575+00
10	1	POST	tags	\N	201	2026-11-13 01:41:05.6+00
11	1	POST	transactions	\N	201	2026-11-13 01:41:05.661+00
12	1	POST	transactions	\N	201	2026-11-13 01:41:05.687+00
13	1	POST	transactions	\N	201	2026-11-13 01:41:05.709+00
14	1	POST	transactions	\N	201	2026-11-13 01:41:05.733+00
15	1	POST	transactions	\N	201	2026-11-13 01:41:05.759+00
16	1	POST	transactions	\N	201	2026-11-13 01:41:05.781+00
17	1	POST	transactions	\N	201	2026-11-13 01:41:05.817+00
18	1	POST	transactions	\N	201	2026-11-13 01:41:05.837+00
19	1	POST	transactions	\N	201	2026-11-13 01:41:05.919+00
20	1	POST	transactions	\N	201	2026-11-13 01:41:05.951+00
21	1	POST	transactions	\N	201	2026-11-13 01:41:05.978+00
22	1	POST	transactions	\N	201	2026-11-13 01:41:06.003+00
23	1	POST	transactions	\N	201	2026-11-13 01:41:06.03+00
24	1	POST	transactions	\N	201	2026-11-13 01:41:06.054+00
25	1	POST	transactions	\N	201	2026-11-13 01:41:06.079+00
26	1	POST	transactions	\N	201	2026-11-13 01:41:06.109+00
27	1	POST	transactions	\N	201	2026-11-13 01:41:06.132+00
28	1	POST	transactions	\N	201	2026-11-13 01:41:06.162+00
29	1	POST	transactions	\N	201	2026-11-13 01:41:06.188+00
30	1	POST	transactions	\N	201	2026-11-13 01:41:06.218+00
31	1	POST	transactions	\N	201	2026-11-13 01:41:06.242+00
32	1	POST	transactions	\N	201	2026-11-13 01:41:06.278+00
33	1	POST	transactions	\N	201	2026-11-13 01:41:06.314+00
34	1	POST	account-snapshots	\N	200	2026-11-13 01:41:06.363+00
35	1	POST	budgets	\N	200	2026-11-13 01:41:06.392+00
36	1	POST	budgets	\N	200	2026-11-13 01:41:06.415+00
37	1	POST	bills	\N	201	2026-11-13 01:41:06.44+00
\.


--
-- Data for Name: backups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.backups (id, user_id, label, size, auto, data, created_at) FROM stdin;
\.


--
-- Data for Name: bill_matches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.bill_matches (id, user_id, bill_id, transaction_id, created_at) FROM stdin;
\.


--
-- Data for Name: bills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.bills (id, user_id, account_id, category_id, name, amount_min, amount_max, start_date, frequency, "interval", pattern, active, created_at) FROM stdin;
1	1	2	\N	G Électricité	40	65	2026-01-10	monthly	1	EDF	t	2026-11-13 01:41:06.432+00
\.


--
-- Data for Name: budgets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.budgets (id, user_id, category_id, month, amount_limit, created_at, recurring, rollover) FROM stdin;
1	1	8	2026-01	300	2026-11-13 01:41:06.381+00	t	t
2	1	9	2026-02	100	2026-11-13 01:41:06.406+00	f	f
3	1	8	2026-02	300	2026-11-13 01:41:06.657+00	t	f
4	1	8	2026-03	300	2026-11-13 01:41:06.782+00	t	f
5	1	8	2026-04	300	2026-11-13 01:41:06.889+00	t	f
6	1	8	2026-05	300	2026-11-13 01:41:06.984+00	t	f
7	1	8	2026-06	300	2026-11-13 01:41:07.075+00	t	f
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.categories (id, user_id, name, type, color, icon, created_at) FROM stdin;
1	1	Courses	expense	#22c55e	shopping-cart	2026-11-13 01:41:05.464+00
2	1	Logement	expense	#f97316	home	2026-11-13 01:41:05.464+00
3	1	Transport	expense	#06b6d4	car	2026-11-13 01:41:05.464+00
4	1	Loisirs	expense	#a855f7	gamepad-2	2026-11-13 01:41:05.464+00
5	1	Santé	expense	#ef4444	heart-pulse	2026-11-13 01:41:05.464+00
6	1	Salaire	income	#16a34a	wallet	2026-11-13 01:41:05.464+00
7	1	Remboursement	income	#0ea5e9	refresh-cw	2026-11-13 01:41:05.464+00
8	1	G Courses	expense	#123456	\N	2026-11-13 01:41:05.542+00
9	1	G Loisirs	expense	#123456	\N	2026-11-13 01:41:05.552+00
10	1	G Santé	expense	#123456	\N	2026-11-13 01:41:05.559+00
11	1	G Salaire	income	#123456	\N	2026-11-13 01:41:05.57+00
\.


--
-- Data for Name: category_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.category_rules (id, user_id, pattern, category_id, created_at) FROM stdin;
\.


--
-- Data for Name: exchange_rates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.exchange_rates (id, base, quote, date, rate, as_of, created_at) FROM stdin;
\.


--
-- Data for Name: goal_contributions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.goal_contributions (id, user_id, goal_id, transaction_id, amount, date, description, created_at) FROM stdin;
\.


--
-- Data for Name: holding_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.holding_orders (id, user_id, holding_id, side, date, quantity, unit_price, fee, created_at) FROM stdin;
\.


--
-- Data for Name: holdings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.holdings (id, user_id, account_id, symbol, name, asset_class, currency, created_at) FROM stdin;
\.


--
-- Data for Name: import_mappings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.import_mappings (id, user_id, name, date_format, columns, created_at) FROM stdin;
\.


--
-- Data for Name: institutions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.institutions (id, user_id, name, created_at) FROM stdin;
\.


--
-- Data for Name: market_data; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.market_data (id, symbol, date, price, currency, as_of, created_at) FROM stdin;
\.


--
-- Data for Name: recurring_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.recurring_transactions (id, user_id, account_id, category_id, amount, type, description, frequency, day_of_month, active, last_executed, created_at, "interval", month_of_year, end_date) FROM stdin;
\.


--
-- Data for Name: refund_allocations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.refund_allocations (id, user_id, refund_transaction_id, expense_transaction_id, amount, created_at) FROM stdin;
1	1	9	8	56	2026-11-13 01:41:05.88+00
2	1	10	7	40	2026-11-13 01:41:05.933+00
3	1	16	6	20	2026-11-13 01:41:06.091+00
4	1	16	15	50	2026-11-13 01:41:06.091+00
5	1	18	17	100	2026-11-13 01:41:06.143+00
\.


--
-- Data for Name: savings_goals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.savings_goals (id, user_id, name, target_amount, current_amount, deadline, color, created_at, account_id) FROM stdin;
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings (key, value, updated_at) FROM stdin;
\.


--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tags (id, user_id, name, color, created_at) FROM stdin;
1	1	G vacances	#ff0000	2026-11-13 01:41:05.596+00
\.


--
-- Data for Name: transaction_splits; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.transaction_splits (id, user_id, transaction_id, category_id, amount, note, created_at) FROM stdin;
1	1	7	8	150	\N	2026-11-13 01:41:05.799+00
2	1	7	9	50	cinéma	2026-11-13 01:41:05.799+00
3	1	20	8	30	\N	2026-11-13 01:41:06.199+00
4	1	20	9	30	\N	2026-11-13 01:41:06.199+00
5	1	20	10	30	\N	2026-11-13 01:41:06.199+00
\.


--
-- Data for Name: transaction_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.transaction_tags (transaction_id, tag_id) FROM stdin;
7	1
\.


--
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.transactions (id, user_id, account_id, category_id, amount, type, date, description, created_at, to_account_id, to_amount, exchange_rate, recurring_transaction_id, refunds_transaction_id, cleared, deleted_at) FROM stdin;
1	1	2	11	2500	income	2026-01-05	Salaire	2026-11-13 01:41:05.637+00	\N	\N	\N	\N	\N	f	\N
2	1	2	11	2500	income	2026-02-05	Salaire	2026-11-13 01:41:05.668+00	\N	\N	\N	\N	\N	f	\N
3	1	2	11	2500	income	2026-03-05	Salaire	2026-11-13 01:41:05.693+00	\N	\N	\N	\N	\N	f	\N
4	1	2	11	2500	income	2026-04-05	Salaire	2026-11-13 01:41:05.716+00	\N	\N	\N	\N	\N	f	\N
5	1	2	11	2500	income	2026-05-05	Salaire	2026-11-13 01:41:05.74+00	\N	\N	\N	\N	\N	f	\N
6	1	2	8	120	expense	2026-01-10	Supermarché	2026-11-13 01:41:05.767+00	\N	\N	\N	\N	\N	t	\N
7	1	2	\N	200	expense	2026-01-12	Achat mixte	2026-11-13 01:41:05.799+00	\N	\N	\N	\N	\N	f	\N
8	1	4	10	80	expense	2026-01-20	Pharmacie	2026-11-13 01:41:05.823+00	\N	\N	\N	\N	\N	f	\N
9	1	2	\N	56	income	2026-02-02	CPAM	2026-11-13 01:41:05.88+00	\N	\N	\N	\N	8	f	\N
10	1	2	11	100	income	2026-02-05	Prime + remboursement	2026-11-13 01:41:05.933+00	\N	\N	\N	\N	\N	f	\N
11	1	2	\N	500	transfer	2026-02-10	Épargne	2026-11-13 01:41:05.961+00	3	500	1	\N	\N	f	\N
12	1	2	\N	300	transfer	2026-03-02	Retrait DAB	2026-11-13 01:41:05.986+00	5	295	0.98	\N	\N	f	\N
13	1	5	\N	30	expense	2026-03-05	Marché	2026-11-13 01:41:06.011+00	\N	\N	\N	\N	\N	f	\N
14	1	\N	8	45	expense	2026-03-07	Sans compte	2026-11-13 01:41:06.037+00	\N	\N	\N	\N	\N	f	\N
15	1	2	9	60	expense	2026-04-01	Concert	2026-11-13 01:41:06.061+00	\N	\N	\N	\N	\N	f	\N
16	1	2	\N	70	income	2026-04-10	Remboursements amis	2026-11-13 01:41:06.091+00	\N	\N	\N	\N	\N	f	\N
17	1	2	\N	100	expense	2026-04-15	Commande	2026-11-13 01:41:06.116+00	\N	\N	\N	\N	\N	f	\N
18	1	2	\N	100	income	2026-04-20	Retour commande	2026-11-13 01:41:06.143+00	\N	\N	\N	\N	17	f	\N
19	1	2	\N	80	transfer	2026-04-25	Prélèvement carte	2026-11-13 01:41:06.171+00	4	80	1	\N	\N	f	\N
20	1	4	\N	90	expense	2026-05-03	Ventilé en trois	2026-11-13 01:41:06.199+00	\N	\N	\N	\N	\N	f	\N
21	1	2	10	52	expense	2026-01-11	EDF facture	2026-11-13 01:41:06.225+00	\N	\N	\N	\N	\N	f	\N
22	1	2	10	48	expense	2026-02-10	EDF facture	2026-11-13 01:41:06.259+00	\N	\N	\N	\N	\N	f	\N
23	1	2	10	61	expense	2026-03-12	EDF facture	2026-11-13 01:41:06.292+00	\N	\N	\N	\N	\N	f	\N
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, name, created_at) FROM stdin;
1	Golden	2026-11-13 01:41:05.437+00
\.


--
-- Name: account_snapshots_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.account_snapshots_id_seq', 1, true);


--
-- Name: accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.accounts_id_seq', 5, true);


--
-- Name: alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.alerts_id_seq', 1, false);


--
-- Name: attachments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.attachments_id_seq', 1, false);


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 37, true);


--
-- Name: backups_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.backups_id_seq', 1, false);


--
-- Name: bill_matches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.bill_matches_id_seq', 1, false);


--
-- Name: bills_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.bills_id_seq', 1, true);


--
-- Name: budgets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.budgets_id_seq', 7, true);


--
-- Name: categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.categories_id_seq', 11, true);


--
-- Name: category_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.category_rules_id_seq', 1, false);


--
-- Name: exchange_rates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.exchange_rates_id_seq', 1, false);


--
-- Name: goal_contributions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.goal_contributions_id_seq', 1, false);


--
-- Name: holding_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.holding_orders_id_seq', 1, false);


--
-- Name: holdings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.holdings_id_seq', 1, false);


--
-- Name: import_mappings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.import_mappings_id_seq', 1, false);


--
-- Name: institutions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.institutions_id_seq', 1, false);


--
-- Name: market_data_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.market_data_id_seq', 1, false);


--
-- Name: recurring_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.recurring_transactions_id_seq', 1, false);


--
-- Name: refund_allocations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.refund_allocations_id_seq', 5, true);


--
-- Name: savings_goals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.savings_goals_id_seq', 1, false);


--
-- Name: tags_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tags_id_seq', 1, true);


--
-- Name: transaction_splits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.transaction_splits_id_seq', 5, true);


--
-- Name: transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.transactions_id_seq', 23, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 1, true);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: account_snapshots account_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_snapshots
    ADD CONSTRAINT account_snapshots_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: backups backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_pkey PRIMARY KEY (id);


--
-- Name: bill_matches bill_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_matches
    ADD CONSTRAINT bill_matches_pkey PRIMARY KEY (id);


--
-- Name: bills bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pkey PRIMARY KEY (id);


--
-- Name: budgets budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: category_rules category_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_rules
    ADD CONSTRAINT category_rules_pkey PRIMARY KEY (id);


--
-- Name: exchange_rates exchange_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_pkey PRIMARY KEY (id);


--
-- Name: goal_contributions goal_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_contributions
    ADD CONSTRAINT goal_contributions_pkey PRIMARY KEY (id);


--
-- Name: holding_orders holding_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holding_orders
    ADD CONSTRAINT holding_orders_pkey PRIMARY KEY (id);


--
-- Name: holdings holdings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holdings
    ADD CONSTRAINT holdings_pkey PRIMARY KEY (id);


--
-- Name: import_mappings import_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_mappings
    ADD CONSTRAINT import_mappings_pkey PRIMARY KEY (id);


--
-- Name: institutions institutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_pkey PRIMARY KEY (id);


--
-- Name: market_data market_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data
    ADD CONSTRAINT market_data_pkey PRIMARY KEY (id);


--
-- Name: recurring_transactions recurring_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_pkey PRIMARY KEY (id);


--
-- Name: refund_allocations refund_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_allocations
    ADD CONSTRAINT refund_allocations_pkey PRIMARY KEY (id);


--
-- Name: savings_goals savings_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_goals
    ADD CONSTRAINT savings_goals_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: transaction_splits transaction_splits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_splits
    ADD CONSTRAINT transaction_splits_pkey PRIMARY KEY (id);


--
-- Name: transaction_tags transaction_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_tags
    ADD CONSTRAINT transaction_tags_pkey PRIMARY KEY (transaction_id, tag_id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: users users_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_name_key UNIQUE (name);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: account_snapshots_account_id_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_snapshots_account_id_date_key ON public.account_snapshots USING btree (account_id, date);


--
-- Name: account_snapshots_user_id_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_snapshots_user_id_date_idx ON public.account_snapshots USING btree (user_id, date);


--
-- Name: accounts_institution_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_institution_id_idx ON public.accounts USING btree (institution_id);


--
-- Name: accounts_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_user_id_idx ON public.accounts USING btree (user_id);


--
-- Name: accounts_user_id_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_user_id_name_key ON public.accounts USING btree (user_id, name);


--
-- Name: alerts_user_id_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alerts_user_id_active_idx ON public.alerts USING btree (user_id, active);


--
-- Name: attachments_transaction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_transaction_id_idx ON public.attachments USING btree (transaction_id);


--
-- Name: attachments_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_user_id_idx ON public.attachments USING btree (user_id);


--
-- Name: audit_log_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_user_id_created_at_idx ON public.audit_log USING btree (user_id, created_at);


--
-- Name: backups_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX backups_created_at_idx ON public.backups USING btree (created_at);


--
-- Name: bill_matches_bill_id_transaction_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_matches_bill_id_transaction_id_key ON public.bill_matches USING btree (bill_id, transaction_id);


--
-- Name: bill_matches_transaction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_matches_transaction_id_idx ON public.bill_matches USING btree (transaction_id);


--
-- Name: bill_matches_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_matches_user_id_idx ON public.bill_matches USING btree (user_id);


--
-- Name: bills_user_id_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bills_user_id_active_idx ON public.bills USING btree (user_id, active);


--
-- Name: bills_user_id_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bills_user_id_name_key ON public.bills USING btree (user_id, name);


--
-- Name: budgets_user_id_category_id_month_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX budgets_user_id_category_id_month_key ON public.budgets USING btree (user_id, category_id, month);


--
-- Name: budgets_user_id_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX budgets_user_id_month_idx ON public.budgets USING btree (user_id, month);


--
-- Name: categories_user_id_name_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX categories_user_id_name_type_key ON public.categories USING btree (user_id, name, type);


--
-- Name: categories_user_id_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX categories_user_id_type_idx ON public.categories USING btree (user_id, type);


--
-- Name: category_rules_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX category_rules_user_id_idx ON public.category_rules USING btree (user_id);


--
-- Name: category_rules_user_id_pattern_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX category_rules_user_id_pattern_key ON public.category_rules USING btree (user_id, pattern);


--
-- Name: exchange_rates_base_quote_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exchange_rates_base_quote_date_key ON public.exchange_rates USING btree (base, quote, date);


--
-- Name: goal_contributions_goal_id_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goal_contributions_goal_id_date_idx ON public.goal_contributions USING btree (goal_id, date);


--
-- Name: goal_contributions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goal_contributions_user_id_idx ON public.goal_contributions USING btree (user_id);


--
-- Name: holding_orders_holding_id_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX holding_orders_holding_id_date_idx ON public.holding_orders USING btree (holding_id, date);


--
-- Name: holding_orders_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX holding_orders_user_id_idx ON public.holding_orders USING btree (user_id);


--
-- Name: holdings_account_id_symbol_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX holdings_account_id_symbol_key ON public.holdings USING btree (account_id, symbol);


--
-- Name: holdings_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX holdings_user_id_idx ON public.holdings USING btree (user_id);


--
-- Name: import_mappings_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX import_mappings_user_id_idx ON public.import_mappings USING btree (user_id);


--
-- Name: import_mappings_user_id_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX import_mappings_user_id_name_key ON public.import_mappings USING btree (user_id, name);


--
-- Name: institutions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX institutions_user_id_idx ON public.institutions USING btree (user_id);


--
-- Name: institutions_user_id_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX institutions_user_id_name_key ON public.institutions USING btree (user_id, name);


--
-- Name: market_data_symbol_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX market_data_symbol_date_key ON public.market_data USING btree (symbol, date);


--
-- Name: recurring_transactions_user_id_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_transactions_user_id_active_idx ON public.recurring_transactions USING btree (user_id, active);


--
-- Name: refund_allocations_expense_transaction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refund_allocations_expense_transaction_id_idx ON public.refund_allocations USING btree (expense_transaction_id);


--
-- Name: refund_allocations_refund_transaction_id_expense_transactio_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX refund_allocations_refund_transaction_id_expense_transactio_key ON public.refund_allocations USING btree (refund_transaction_id, expense_transaction_id);


--
-- Name: refund_allocations_refund_transaction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refund_allocations_refund_transaction_id_idx ON public.refund_allocations USING btree (refund_transaction_id);


--
-- Name: refund_allocations_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refund_allocations_user_id_idx ON public.refund_allocations USING btree (user_id);


--
-- Name: savings_goals_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX savings_goals_account_id_idx ON public.savings_goals USING btree (account_id);


--
-- Name: savings_goals_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX savings_goals_user_id_idx ON public.savings_goals USING btree (user_id);


--
-- Name: tags_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tags_user_id_idx ON public.tags USING btree (user_id);


--
-- Name: tags_user_id_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tags_user_id_name_key ON public.tags USING btree (user_id, name);


--
-- Name: transaction_splits_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transaction_splits_category_id_idx ON public.transaction_splits USING btree (category_id);


--
-- Name: transaction_splits_transaction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transaction_splits_transaction_id_idx ON public.transaction_splits USING btree (transaction_id);


--
-- Name: transaction_splits_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transaction_splits_user_id_idx ON public.transaction_splits USING btree (user_id);


--
-- Name: transaction_tags_tag_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transaction_tags_tag_id_idx ON public.transaction_tags USING btree (tag_id);


--
-- Name: transactions_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_account_id_idx ON public.transactions USING btree (account_id);


--
-- Name: transactions_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_category_id_idx ON public.transactions USING btree (category_id);


--
-- Name: transactions_recurring_transaction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_recurring_transaction_id_idx ON public.transactions USING btree (recurring_transaction_id);


--
-- Name: transactions_refunds_transaction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_refunds_transaction_id_idx ON public.transactions USING btree (refunds_transaction_id);


--
-- Name: transactions_to_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_to_account_id_idx ON public.transactions USING btree (to_account_id);


--
-- Name: transactions_user_id_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_user_id_date_idx ON public.transactions USING btree (user_id, date);


--
-- Name: transactions_user_id_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_user_id_deleted_at_idx ON public.transactions USING btree (user_id, deleted_at);


--
-- Name: account_snapshots account_snapshots_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_snapshots
    ADD CONSTRAINT account_snapshots_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: account_snapshots account_snapshots_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_snapshots
    ADD CONSTRAINT account_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: accounts accounts_institution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES public.institutions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: alerts alerts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: alerts alerts_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.savings_goals(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: alerts alerts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: attachments attachments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: attachments attachments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bill_matches bill_matches_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_matches
    ADD CONSTRAINT bill_matches_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bill_matches bill_matches_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_matches
    ADD CONSTRAINT bill_matches_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bill_matches bill_matches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_matches
    ADD CONSTRAINT bill_matches_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bills bills_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bills bills_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bills bills_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budgets budgets_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budgets budgets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: categories categories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: category_rules category_rules_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_rules
    ADD CONSTRAINT category_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: category_rules category_rules_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_rules
    ADD CONSTRAINT category_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: goal_contributions goal_contributions_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_contributions
    ADD CONSTRAINT goal_contributions_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.savings_goals(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: goal_contributions goal_contributions_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_contributions
    ADD CONSTRAINT goal_contributions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: goal_contributions goal_contributions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_contributions
    ADD CONSTRAINT goal_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: holding_orders holding_orders_holding_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holding_orders
    ADD CONSTRAINT holding_orders_holding_id_fkey FOREIGN KEY (holding_id) REFERENCES public.holdings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: holding_orders holding_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holding_orders
    ADD CONSTRAINT holding_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: holdings holdings_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holdings
    ADD CONSTRAINT holdings_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: holdings holdings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holdings
    ADD CONSTRAINT holdings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: import_mappings import_mappings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_mappings
    ADD CONSTRAINT import_mappings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: institutions institutions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: recurring_transactions recurring_transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: recurring_transactions recurring_transactions_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: recurring_transactions recurring_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: refund_allocations refund_allocations_expense_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_allocations
    ADD CONSTRAINT refund_allocations_expense_transaction_id_fkey FOREIGN KEY (expense_transaction_id) REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: refund_allocations refund_allocations_refund_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_allocations
    ADD CONSTRAINT refund_allocations_refund_transaction_id_fkey FOREIGN KEY (refund_transaction_id) REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: refund_allocations refund_allocations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_allocations
    ADD CONSTRAINT refund_allocations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: savings_goals savings_goals_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_goals
    ADD CONSTRAINT savings_goals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: savings_goals savings_goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_goals
    ADD CONSTRAINT savings_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tags tags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_splits transaction_splits_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_splits
    ADD CONSTRAINT transaction_splits_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_splits transaction_splits_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_splits
    ADD CONSTRAINT transaction_splits_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_splits transaction_splits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_splits
    ADD CONSTRAINT transaction_splits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_tags transaction_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_tags
    ADD CONSTRAINT transaction_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transaction_tags transaction_tags_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_tags
    ADD CONSTRAINT transaction_tags_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: transactions transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transactions transactions_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transactions transactions_recurring_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_recurring_transaction_id_fkey FOREIGN KEY (recurring_transaction_id) REFERENCES public.recurring_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transactions transactions_refunds_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_refunds_transaction_id_fkey FOREIGN KEY (refunds_transaction_id) REFERENCES public.transactions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transactions transactions_to_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_to_account_id_fkey FOREIGN KEY (to_account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict FGlFndCV1AzmPTDVWDu3e9VRHK4jn2dyyip1raxqC4BQOXNQofonoOzuKRu5VYq

