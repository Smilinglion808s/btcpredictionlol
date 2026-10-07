"""Optional owner-only controls. Public keys only; never exchange/admin secrets."""
from dataclasses import dataclass
import os
from urllib.parse import urlparse
import jwt

class AuthError(Exception):
    def __init__(self,code,status=401):self.code=code;self.status=status

@dataclass(frozen=True)
class AuthConfig:
    issuer: str = ''
    audience: str = 'authenticated'
    owner_id: str = ''
    controls_enabled: bool = False
    def __post_init__(self):
        if self.issuer:
            p=urlparse(self.issuer)
            if p.scheme!='https' or not p.hostname or p.username or p.password or p.query or p.fragment or p.port:
                raise ValueError('Auth issuer must be pinned HTTPS without credentials')
            if not self.issuer.endswith('/auth/v1'):raise ValueError('Expected existing Supabase auth issuer')
        if self.controls_enabled and not(self.owner_id and self.issuer):raise ValueError('Explicit existing owner and issuer required')

class OwnerAuth:
    def __init__(self,config,client=None):
        self.cfg=config
        self.client=client or (jwt.PyJWKClient(config.issuer+'/.well-known/jwks.json',cache_jwk_set=True,lifespan=300,timeout=5) if config.issuer else None)
    def verify(self,authorization):
        if not self.cfg.controls_enabled or not self.client:raise AuthError('CONTROLS_DISABLED',503)
        if not authorization or not authorization.startswith('Bearer '):raise AuthError('AUTH_REQUIRED')
        token=authorization[7:]
        if not token or len(token)>16384:raise AuthError('AUTH_REQUIRED')
        try:
            header=jwt.get_unverified_header(token)
            if header.get('alg') not in {'ES256','RS256'} or not header.get('kid'):raise ValueError('Unsupported signing method')
            key=self.client.get_signing_key_from_jwt(token).key
            claims=jwt.decode(token,key,algorithms=['ES256','RS256'],audience=self.cfg.audience,issuer=self.cfg.issuer,
                options={'require':['exp','iat','sub','aud','iss']},leeway=5)
            if claims.get('is_anonymous') or claims.get('role')!='authenticated':raise ValueError('Owner login required')
        except (jwt.PyJWTError,ValueError,TypeError):raise AuthError('AUTH_REQUIRED')
        if claims['sub']!=self.cfg.owner_id:raise AuthError('OWNER_REQUIRED',403)
        return claims['sub']

def from_env():
    return AuthConfig(issuer=os.getenv('DOT_PAPER_AUTH_ISSUER','').rstrip('/'),
        audience=os.getenv('DOT_PAPER_AUTH_AUDIENCE','authenticated'),owner_id=os.getenv('DOT_PAPER_OWNER_ID',''),
        controls_enabled=os.getenv('DOT_PAPER_CONTROLS_ENABLED')=='true')
