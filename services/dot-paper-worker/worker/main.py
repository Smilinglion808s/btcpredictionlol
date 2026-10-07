"""Persistent HTTP/maintenance process; live adapter intentionally unconfigured."""
import os
from pathlib import Path

def main():
    if os.geteuid()==0 or (os.getenv('RAILWAY_SERVICE_ID') and (os.geteuid()!=10001 or os.getegid()!=10001)):
        raise SystemExit('UNPRIVILEGED_BOOTSTRAP_REQUIRED')
    os.umask(0o077)
    import uvicorn
    from .config import from_env
    from .auth import OwnerAuth,from_env as auth_from_env
    from .engine import Engine
    from .api import create_app
    from .marketdata import KrakenObserver
    data=Path(os.getenv('DOT_PAPER_DATA_DIR','./data/dot-paper'))
    engine=Engine(data/'paper.sqlite3',from_env())
    observer=KrakenObserver(engine,max_seconds=int(os.getenv('DOT_PAPER_OBSERVER_SECONDS','86400'))) if engine.cfg.feed_enabled else None
    server=None
    def observer_complete(result):
        if result!='STOPPED' and server:server.should_exit=True
    app=create_app(engine,OwnerAuth(auth_from_env()),observer=observer,on_observer_complete=observer_complete)
    # One process only. No uvicorn reload, worker replication, auto-trading cron or webhooks.
    server=uvicorn.Server(uvicorn.Config(app,host=os.getenv('DOT_PAPER_BIND','127.0.0.1'),port=int(os.getenv('PORT','8080')),
                workers=1,access_log=False,log_level='warning',server_header=False))
    server.run()

if __name__=='__main__':main()
