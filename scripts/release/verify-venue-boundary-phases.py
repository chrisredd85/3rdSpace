#!/usr/bin/env python3
"""Exercise venue boundary phases in a disposable, socket-only PostgreSQL 17.

No target connection argument or ambient PostgreSQL configuration is accepted.
The SQL fixtures are representative local schemas, not a hosted replay.
"""

import argparse
import hashlib
import json
from pathlib import Path
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time


ROOT = Path(__file__).resolve().parents[2]
APPROVED_SOURCE = "215d55d"
PHASES = ("expand", "activate", "harden")
MIGRATIONS = {
    "expand": ("20260922000002_expand_venue_discovery_boundary.sql",
               "0bb8f3fd634388d2a77c505115f0ebffa28735dd074223cf3363b494422d6152"),
    "activate": ("20260922000003_activate_venue_discovery_boundary.sql",
                 "f742bf548b2daee25bf202cd4812a4c67cfb7369c426f62670b575c72e6413e6"),
    "harden": ("20260922000004_harden_venue_discovery_boundary.sql",
               "d4cd5d96c08145e81dfe256e1f7692fb2ea56ccb2a52e2eed3fe24c424e91249"),
}
FIXTURES = {
    "expand": ("verify-venue-boundary-expand.sql",),
    "activate": ("verify-venue-boundary-expand.sql", "verify-venue-boundary-activate.sql"),
    "harden": ("verify-venue-boundary-expand.sql", "verify-venue-persistence-boundary.sql"),
}
INCLUDE = re.compile(r"(?m)^\\ir\s+(.+?)\s*$")
READ_SOURCE = re.compile(r"current_setting\('fixture\.repo_root'\)\s*\|\|\s*'(/[^']+\.sql)'")
VERSION = "20260922000003"
NAME = "activate_venue_discovery_boundary"

CATALOG_SQL = """
SELECT jsonb_build_object(
  'schemas', (SELECT jsonb_agg(jsonb_build_array(nspname,nspacl) ORDER BY nspname)
    FROM pg_namespace WHERE nspname IN ('public','private','supabase_migrations')),
  'relations', (SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relacl,c.reloptions,
      CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) ELSE NULL END)
      ORDER BY n.nspname,c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private','supabase_migrations') AND c.relkind IN ('r','v')),
  'columns', (SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,a.attacl,a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid)) ORDER BY n.nspname,c.relname,a.attnum)
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname IN ('public','private','supabase_migrations') AND a.attnum>0 AND NOT a.attisdropped
      AND c.relkind IN ('r','v')),
  'functions', (SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,
      pg_get_function_identity_arguments(p.oid),p.proacl,pg_get_functiondef(p.oid))
      ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p')),
  'triggers', (SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid))
      ORDER BY n.nspname,c.relname,t.tgname)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private') AND NOT t.tgisinternal),
  'ledger', (SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM supabase_migrations.schema_migrations m)
);
"""


class PhaseSources:
    """Resolve only the chosen phase and its approved earlier dependencies."""

    def __init__(self, phase, prerequisite_root):
        self.phase = phase
        self.prerequisite_root = prerequisite_root.resolve() if prerequisite_root else None
        self.files = {}
        self.fixture_text = {}
        self.includes = {}
        self.migrations = {}
        self.resolved = {}
        for required in PHASES[:PHASES.index(phase) + 1]:
            filename, expected = MIGRATIONS[required]
            relative = Path("supabase/migrations") / filename
            path = ROOT / relative
            origin = "current_branch"
            # A present, mismatched local prerequisite must never fall back.
            if required != phase and not path.exists() and self.prerequisite_root:
                path = self.prerequisite_root / relative
                origin = "prerequisite_root"
            digest = self.record(path)
            if digest != expected:
                raise ValueError(f"{required} migration differs from approved {APPROVED_SOURCE}: {path}")
            self.migrations[required] = path.resolve()
            self.resolved[required] = {"path": str(path.resolve()), "root": str(path.resolve().parents[2]),
                                       "origin": origin, "sha256": digest,
                                       "approved_sha256": expected, "target": required == phase}
        self.fixtures = [ROOT / "scripts/release" / name for name in FIXTURES[phase]]
        for fixture in self.fixtures:
            self.discover_fixture(fixture, set())
        self.record(Path(__file__).resolve())
        self.head = subprocess.check_output(
            ["/usr/bin/git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"}).strip()

    def record(self, path):
        path = path.resolve()
        if not path.is_file():
            raise ValueError(f"Required local source missing: {path}; use --prerequisite-root for earlier migrations")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        previous = self.files.setdefault(path, digest)
        if previous != digest:
            raise ValueError(f"Source changed during preflight: {path}")
        return digest

    def include_path(self, fixture, token):
        token = token.strip()
        if token[:1] in {"'", '"'}:
            quote = token[0]
            if len(token) < 2 or token[-1] != quote:
                raise ValueError(f"Invalid fixture include in {fixture}: {token}")
            token = token[1:-1].replace(quote * 2, quote)
        if "\n" in token or "\r" in token or not token:
            raise ValueError(f"Invalid fixture include in {fixture}")
        path = (fixture.parent / token).resolve()
        for phase, (filename, _) in MIGRATIONS.items():
            if path.name == filename:
                if phase not in self.migrations:
                    raise ValueError(f"{self.phase} fixture attempts to read future phase {phase}: {fixture}")
                return self.migrations[phase]
        if not path.is_relative_to(ROOT):
            raise ValueError(f"Fixture include escapes current checkout: {path}")
        return path

    def discover_fixture(self, path, ancestors):
        path = path.resolve()
        if path in ancestors:
            raise ValueError(f"Recursive fixture include: {path}")
        if path in self.fixture_text:
            return
        self.record(path)
        source = path.read_text()
        self.fixture_text[path] = source
        targets = {}
        for match in INCLUDE.finditer(source):
            target = self.include_path(path, match.group(1))
            targets[match.group(1)] = target
            if target not in self.migrations.values():
                self.discover_fixture(target, ancestors | {path})
        self.includes[path] = targets
        # Actual historical RPC/control sources always belong to this checkout.
        for relative in READ_SOURCE.findall(source):
            baseline = (ROOT / relative.lstrip("/")).resolve()
            if not baseline.is_relative_to(ROOT):
                raise ValueError(f"Historical function source escapes checkout: {baseline}")
            self.record(baseline)

    def verify_unchanged(self):
        for path, expected in self.files.items():
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise RuntimeError(f"Reviewed source changed during verification: {path}")

    def evidence(self):
        return {"phase": self.phase, "target_head": self.head, "target_root": str(ROOT),
                "approved_prerequisite_source": APPROVED_SOURCE,
                "prerequisite_root": str(self.prerequisite_root) if self.prerequisite_root else None,
                "resolved_migrations": self.resolved,
                "source_sha256": {str(path): digest for path, digest in sorted(self.files.items())}}


class LocalProof:
    def __init__(self, pg_bin, sources):
        self.sources = sources
        self.out = ROOT / f"test-results/c1-landing-{sources.phase}"
        self.out.mkdir(parents=True, exist_ok=True)
        self.activate = sources.migrations.get("activate")
        self.rendered_fixtures = {}
        self.pg = pg_bin.resolve()
        # Never inherit HOME, service selectors, DB URLs, credentials or PGOPTIONS.
        self.cluster = Path(tempfile.mkdtemp(prefix="3p-venue-", dir="/tmp"))
        self.socket = self.cluster / "socket"
        self.socket.mkdir(mode=0o700)
        # libpq warns for /dev/null because it is not a plain file. Empty private
        # files also prevent falling back to the operator's actual pass/service files.
        for filename in ("empty.pgpass", "empty.pg_service.conf"):
            (self.cluster / filename).touch(mode=0o600)
        self.env = {"PATH": f"{self.pg}:/usr/bin:/bin", "LC_ALL": "C",
                    "PGPASSFILE": str(self.cluster / "empty.pgpass"),
                    "PGSERVICEFILE": str(self.cluster / "empty.pg_service.conf")}
        self.started = False
        self.log = (self.out / "disposable-pg.log").open("w")
        self.result = {"local_only": True, "no_tcp_listener": True, "postgres_major": 17,
                       "fixtures": {}, "atomic_checks": {}, "status": "FAIL", **sources.evidence()}

    def run(self, args, *, sql=None, expected_error=None, log_output=True, timeout=180):
        completed = subprocess.run([str(x) for x in args], input=sql, cwd=ROOT, env=self.env,
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   timeout=timeout)
        if log_output:
            self.log.write(completed.stdout)
            self.log.flush()
        if expected_error is not None:
            if completed.returncode == 0 or expected_error not in completed.stdout:
                raise RuntimeError(f"Expected failure absent: {expected_error}; see disposable-pg.log")
        elif completed.returncode:
            raise RuntimeError("Disposable command failed; see disposable-pg.log")
        return completed.stdout

    def psql(self):
        return [self.pg / "psql", "-X", "--no-password", "-h", self.socket, "-p", "55443",
                "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
                "-v", "VERBOSITY=verbose"]

    def query(self, sql, **kwargs):
        return self.run(self.psql() + ["-A", "-t", "-c", sql], **kwargs).strip()

    def snapshot(self):
        return json.loads(self.query(CATALOG_SQL, log_output=False))

    def control(self):
        return self.query("SELECT to_jsonb(c) FROM public.release_runtime_controls c "
                          "WHERE control_key='write_pause'", log_output=False)

    def mark(self, label):
        self.result["atomic_checks"][label] = "PASS"
        self.log.write(f"PASS: {label}\n")
        self.log.flush()

    def render_fixture(self, path):
        path = path.resolve()
        if path in self.rendered_fixtures:
            return self.rendered_fixtures[path]
        target = self.cluster / (hashlib.sha256(str(path).encode()).hexdigest()[:12] + "-" + path.name)
        self.rendered_fixtures[path] = target

        def absolute_include(match):
            included = self.sources.includes[path][match.group(1)]
            if included in self.sources.fixture_text:
                included = self.render_fixture(included)
            return "\\ir '" + str(included).replace("'", "''") + "'"

        target.write_text(INCLUDE.sub(absolute_include, self.sources.fixture_text[path]))
        return target

    def fixture(self, path, label):
        output = self.run(self.psql() + ["-f", self.render_fixture(path)])
        labels = [line.strip() for line in output.splitlines() if re.search(r"\bPASS:", line)]
        if not labels:
            raise RuntimeError(f"Fixture {label} produced no PASS labels")
        self.result["fixtures"][label] = {"status": "PASS", "pass_label_count": len(labels),
                                           "pass_labels": labels}

    def set_control(self, state):
        # Local fixture preparation only. C1 itself never changes this control.
        self.query("DELETE FROM public.release_runtime_controls WHERE control_key='write_pause'")
        if state is not None:
            if state not in {"open", "paused", "draining"}:
                raise ValueError("Invalid local fixture state")
            enabled = "false" if state == "open" else "true"
            enabled_at = "NULL" if state == "open" else "clock_timestamp()"
            self.query("INSERT INTO public.release_runtime_controls"
                       "(control_key,state,enabled,enabled_at,reason,changed_by,revision) VALUES "
                       f"('write_pause','{state}',{enabled},{enabled_at},'local fixture','local proof',0)")

    def apply(self, *, failure=False, ledger=True, expected_error=None):
        # Match the existing release wrapper's one-transaction file + ledger semantics.
        args = self.psql() + ["--single-transaction", "-c",
                             "SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='15min';",
                             "-f", self.activate]
        if failure:
            args += ["-c", "DO $failure$ BEGIN RAISE EXCEPTION 'local_injected_failure_before_ledger'; END $failure$;"]
        if ledger:
            args += ["-c", "INSERT INTO supabase_migrations.schema_migrations(version,statements,name) "
                     f"VALUES ('{VERSION}',NULL,'{NAME}');"]
        return self.run(args, expected_error=expected_error)

    def prepare_committed_expand(self):
        source = self.render_fixture(self.sources.fixtures[0]).read_text()
        if not re.search(r"ROLLBACK;\s*\Z", source):
            raise RuntimeError("EXPAND fixture must end with ROLLBACK")
        source = re.sub(r"ROLLBACK;\s*\Z", "COMMIT;\n", source)
        fixture = self.cluster / "committed-expand.sql"
        fixture.write_text(source)
        self.run(self.psql() + ["-f", fixture])
        self.query("INSERT INTO supabase_migrations.schema_migrations(version,statements,name) "
                   "VALUES ('20260922000002',NULL,'expand_venue_discovery_boundary')")

    def concurrency(self):
        before = self.snapshot()
        control = self.control()
        proc = subprocess.Popen([str(x) for x in self.psql() + ["-f", "-"]], cwd=ROOT, env=self.env,
                                text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, bufsize=1)
        messages = queue.Queue()
        output = []

        def collect():
            for line in proc.stdout:
                output.append(line)
                messages.put(line)
            messages.put(None)

        reader = threading.Thread(target=collect, daemon=True)
        reader.start()
        success = False
        try:
            path = str(self.activate).replace("'", "''")
            proc.stdin.write("BEGIN;\nSET LOCAL lock_timeout='10s';\nSET LOCAL statement_timeout='15min';\n"
                             f"\\i '{path}'\n\\echo C1_ACTIVATE_HOLD_READY\n")
            proc.stdin.flush()
            deadline = time.monotonic() + 30
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError("ACTIVATE session did not reach its held-transaction marker")
                line = messages.get(timeout=remaining)
                if line is None:
                    raise RuntimeError("ACTIVATE session exited before the concurrency marker")
                if line.strip() == "C1_ACTIVATE_HOLD_READY":
                    break
            self.query("SET lock_timeout='500ms'; SELECT public.transition_release_runtime_control("
                       "(SELECT revision FROM public.release_runtime_controls WHERE control_key='write_pause'),"
                       "'draining','local contention proof','local proof')", expected_error="55P03")
            self.query("BEGIN; SET LOCAL lock_timeout='500ms'; "
                       "SELECT state FROM public.release_runtime_controls WHERE control_key='write_pause' FOR SHARE; ROLLBACK;")
            success = True
        finally:
            if proc.poll() is None:
                try:
                    proc.stdin.write("ROLLBACK;\n")
                    proc.stdin.flush()
                    proc.stdin.close()
                    proc.wait(timeout=20)
                except (BrokenPipeError, subprocess.TimeoutExpired):
                    proc.kill()
                    proc.wait(timeout=10)
            reader.join(timeout=5)
            self.log.write("".join(output))
            self.log.flush()
        if not success or proc.returncode != 0:
            raise RuntimeError("Concurrency fixture failed; see disposable-pg.log")
        if self.snapshot() != before or self.control() != control:
            raise RuntimeError("Held ACTIVATE rollback changed catalog, ledger or pause state")
        self.mark("ACTIVATE FOR SHARE blocks real transition FOR UPDATE; receipt-style FOR SHARE succeeds")
        # This uses the real Phase-4 transition after ACTIVATE releases its row lock.
        self.query("SELECT public.transition_release_runtime_control("
                   "(SELECT revision FROM public.release_runtime_controls WHERE control_key='write_pause'),"
                   "'draining','local post-lock proof','local proof')")
        if json.loads(self.control())["state"] != "draining":
            raise RuntimeError("Transition did not succeed after ACTIVATE released its lock")
        self.mark("Phase-4 transition succeeds after ACTIVATE releases its lock")

    def atomic(self):
        self.prepare_committed_expand()
        for state in (None, "open", "draining"):
            self.set_control(state)
            before, control = self.snapshot(), self.control()
            self.apply(expected_error="venue_boundary_activation_requires_write_pause")
            if self.snapshot() != before or self.control() != control:
                raise RuntimeError(f"Rejected state {state} changed catalog, ACLs, ledger or control")
            self.mark(f"ACTIVATE rejects {state or 'missing row'} without DDL/ACL/ledger/control changes")
        self.query("ALTER TABLE public.release_runtime_controls RENAME TO fixture_hidden_release_controls")
        try:
            before = self.snapshot()
            self.apply(expected_error='42P01')
            if self.snapshot() != before:
                raise RuntimeError("Missing control table rejection changed the catalog/ledger")
        finally:
            self.query("ALTER TABLE public.fixture_hidden_release_controls RENAME TO release_runtime_controls")
        self.mark("ACTIVATE rejects missing control table without DDL/ACL/ledger changes")
        self.set_control("paused")
        before, control = self.snapshot(), self.control()
        self.apply(failure=True, expected_error="local_injected_failure_before_ledger")
        if self.snapshot() != before or self.control() != control:
            raise RuntimeError("Injected failure failed to roll back DDL/ACL/functions/ledger/control")
        (self.out / "atomic-before-catalog.json").write_text(json.dumps(before, indent=2) + "\n")
        self.mark("Failure after ACTIVATE before ledger rolls back DDL, functions, ACLs and ledger")
        self.concurrency()
        self.set_control("paused")
        control = self.control()
        self.apply()
        if self.control() != control:
            raise RuntimeError("Successful ACTIVATE changed pause control")
        after = self.snapshot()
        if not any(row["version"] == VERSION and row["statements"] is None
                   and row["name"] == NAME for row in after["ledger"]):
            raise RuntimeError("ACTIVATE ledger record missing or incorrect")
        count = self.query("SELECT count(*) FROM pg_trigger WHERE tgname='fence_venue_durable_sink' AND NOT tgisinternal")
        if count != "26":
            raise RuntimeError(f"Expected 26 ACTIVATE guards, got {count}")
        self.mark("Paused ACTIVATE commits 26 guards and ledger together without changing pause state")
        self.apply(ledger=False)
        if self.snapshot() != after or self.control() != control:
            raise RuntimeError("Repeated ACTIVATE changed catalog, ledger or pause state")
        self.mark("ACTIVATE reapplication is catalog/ACL/function/ledger idempotent")
        (self.out / "atomic-after-catalog.json").write_text(json.dumps(after, indent=2) + "\n")

    def execute(self):
        try:
            version = self.run([self.pg / "postgres", "--version"])
            if not re.search(r"PostgreSQL\) 17\.", version):
                raise RuntimeError("This fixture requires PostgreSQL 17")
            self.run([self.pg / "initdb", "-D", self.cluster / "data", "-U", "postgres",
                      "--auth=trust", "--no-locale", "--encoding=UTF8"])
            self.run([self.pg / "pg_ctl", "-D", self.cluster / "data", "-l", self.cluster / "server.log",
                      "-o", f"-c listen_addresses='' -c unix_socket_permissions=0700 -k {self.socket} -p 55443", "-w", "start"])
            self.started = True
            if self.query("SHOW listen_addresses") != "":
                raise RuntimeError("Disposable server unexpectedly has a TCP listener")
            for path in self.sources.fixtures:
                self.fixture(path, path.stem)
            if self.sources.phase == "activate":
                self.atomic()
            self.sources.verify_unchanged()
            self.result["status"] = "PASS"
        except Exception as error:
            self.result["error"] = str(error)
        finally:
            stopped = not self.started
            if self.started:
                try:
                    self.run([self.pg / "pg_ctl", "-D", self.cluster / "data", "-m", "fast", "-w", "stop"])
                    stopped = True
                except Exception as error:
                    self.result["status"] = "FAIL"
                    self.result["cleanup_error"] = str(error)
            self.log.close()
            if stopped:
                shutil.rmtree(self.cluster)
            self.result["cluster_stopped_removed"] = stopped and not self.cluster.exists()
            self.result["fixture_pass_labels"] = sum(x["pass_label_count"] for x in self.result["fixtures"].values())
            self.result["atomic_pass_count"] = len(self.result["atomic_checks"])
            (self.out / "disposable-pg-results.json").write_text(json.dumps(self.result, indent=2) + "\n")
        print(json.dumps({key: self.result[key] for key in
                          ("status", "fixture_pass_labels", "atomic_pass_count", "cluster_stopped_removed")}
                         | ({"error": self.result["error"]} if "error" in self.result else {})))
        return 0 if self.result["status"] == "PASS" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", required=True, choices=PHASES,
                        help="Verify exactly one migration phase and its approved prerequisites")
    parser.add_argument("--prerequisite-root", type=Path,
                        help="Local checkout containing approved earlier migration files missing here")
    parser.add_argument("--pg-bin", type=Path, default=Path("/opt/homebrew/opt/postgresql@17/bin"),
                        help="Local PostgreSQL 17 binaries; no database connection accepted")
    args = parser.parse_args()
    for binary in ("postgres", "initdb", "pg_ctl", "psql"):
        if not (args.pg_bin / binary).is_file():
            parser.error(f"Missing local PostgreSQL binary: {binary}")
    # Resolve and hash every required source before creating a cluster or running PostgreSQL.
    try:
        sources = PhaseSources(args.phase, args.prerequisite_root)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    return LocalProof(args.pg_bin, sources).execute()


if __name__ == "__main__":
    raise SystemExit(main())
