from __future__ import annotations
from contextlib import asynccontextmanager
import asyncio
import re
from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from .auth import AuthError

class Control(BaseModel):
    model_config=ConfigDict(extra='forbid')
    action: Literal['start','pause','reset_circuit_breaker']
    request_id: str=Field(min_length=36,max_length=36)


def public_snapshot(engine):
    """Only synthetic paper observability is public. Internal operations stay private."""
    data=engine.snapshot()
    data['simulator'].pop('lease_owner',None)
    data['simulator'].pop('lease_expires_ms',None)
    # Owner actions, writer IDs, paths, and raw exceptions never leave public surface.
    data['audit']={'items':[],'next_cursor':None}
    # Rights clearance is for private observation, not raw quote redistribution.
    for field in ['bid_micros','ask_micros','spread_bps']:data['feed'][field]=None
    return data


def create_app(engine,auth,background=True,observer=None,on_observer_complete=None,allow_test_api=False):
    if engine.cfg.ledger_kind!='FORWARD' and not allow_test_api:raise ValueError('Test ledger cannot be publicly served')
    stop=asyncio.Event()
    async def maintenance():
        while not stop.is_set():
            try:engine.tick()
            except Exception:
                # Lost lease/storage failure: stop servicing; no automatic second writer.
                app.state.failed=True
                break
            try:await asyncio.wait_for(stop.wait(),timeout=1)
            except TimeoutError:pass
    @asynccontextmanager
    async def lifespan(app):
        task=asyncio.create_task(maintenance()) if background else None
        async def observe():
            try:result=await observer.run(stop)
            except asyncio.CancelledError:raise
            except Exception:
                app.state.failed=True;result='OBSERVER_FAILED_CLOSED'
            if on_observer_complete:on_observer_complete(result)
        observer_task=asyncio.create_task(observe()) if observer else None
        yield
        stop.set()
        if observer_task:
            observer_task.cancel()
            try:await observer_task
            except asyncio.CancelledError:pass
        if task:await task
        engine.close()
    app=FastAPI(title='DOT PAPER BTC',version='1',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    app.state.failed=False
    @app.middleware('http')
    async def safety_headers(request:Request,call_next):
        if request.method not in {'GET','POST','HEAD'}:return JSONResponse({'code':'METHOD_NOT_ALLOWED'},status_code=405)
        try:length=int(request.headers.get('content-length','0'))
        except ValueError:return JSONResponse({'code':'INVALID_CONTENT_LENGTH'},status_code=400)
        if length>4096:return JSONResponse({'code':'BODY_TOO_LARGE'},status_code=413)
        if app.state.failed and request.url.path!='/health':return JSONResponse({'code':'WORKER_UNAVAILABLE','message':'Worker requires operator review'},status_code=503)
        response=await call_next(request)
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        return response
    @app.exception_handler(AuthError)
    async def auth_error(request,exc):return JSONResponse({'code':exc.code,'message':exc.code.replace('_',' ')},status_code=exc.status)
    @app.exception_handler(ValueError)
    async def bad_request(request,exc):
        message=str(exc)
        if not re.fullmatch('[A-Z_]{3,80}',message):message='INVALID_REQUEST'
        return JSONResponse({'code':message,'message':message.replace('_',' ')},status_code=409)
    @app.exception_handler(Exception)
    async def hidden_error(request,exc):return JSONResponse({'code':'INTERNAL_ERROR','message':'Operation unavailable'},status_code=503)
    @app.get('/health')
    def health():
        return JSONResponse({'service':'dot-paper-btc','mode':'PAPER','status':'ERROR' if app.state.failed else 'OK',
                             'live_feed_enabled':engine.cfg.feed_enabled,'real_orders_supported':False},status_code=503 if app.state.failed else 200)
    @app.get('/api/v1/snapshot')
    def snapshot():return public_snapshot(engine)
    @app.get('/api/v1/status')
    def status():return public_snapshot(engine)
    @app.get('/api/v1/config')
    def config():
        s=public_snapshot(engine)
        return {k:s[k] for k in ['schema_version','mode','symbol','strategy','risk','assumptions']}
    @app.get('/api/v1/positions')
    def positions():
        s=engine.snapshot();p=s['position'];return {'items':[p] if p else [],'next_cursor':None,'run_id':s['run_id'],'provenance':s['provenance']}
    @app.get('/api/v1/{collection}')
    def collection(collection:str,limit:int=50,before:int|None=None):
        if collection not in {'trades','calls','equity'}:return JSONResponse({'code':'NOT_FOUND'},status_code=404)
        with engine.store.lock:
            return dict(engine.store.page(collection,limit,before),run_id=engine._s()['run_id'],provenance=engine.cfg.ledger_kind)
    @app.post('/api/v1/control')
    def control(body:Control,authorization:str|None=Header(default=None)):
        auth.verify(authorization)
        return engine.control(body.action,body.request_id)
    return app
