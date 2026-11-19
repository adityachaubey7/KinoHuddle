"""
End-to-end journey for SyncSpace, run against a live client + API.

Three separate browser contexts (separate cookies = separate users) sign up, create and join a room,
then verify synced play/pause/seek, drift correction, chat, reactions, late join, refresh and reconnect
recovery, invalid codes and unauthorized access.

YouTube is replaced by `mock_yt.js`, a stand-in for the IFrame Player API with a real clock, so the test
is deterministic and runs offline. It exercises SyncSpace's sync logic, not YouTube itself.

Usage:  pip install playwright && playwright install chromium
        python3 e2e/journey.py e2e/shots          (client at E2E_BASE, default http://localhost:4173)
"""
import asyncio, os, re, sys, random, json
from playwright.async_api import async_playwright, expect

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from thumbs import thumb  # noqa: E402

BASE = os.environ.get('E2E_BASE', 'http://localhost:4173')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'shots')
os.makedirs(SHOTS, exist_ok=True)
MOCK = open(os.path.join(HERE, 'mock_yt.js')).read()
results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

_thumb_cache = {}
async def route(r):
    url = r.request.url
    if 'i.ytimg.com' in url:
        vid = url.split('/vi/')[1].split('/')[0]
        if vid not in _thumb_cache: _thumb_cache[vid] = thumb(vid)
        return await r.fulfill(status=200, content_type='image/jpeg', body=_thumb_cache[vid])
    if 'youtube.com/iframe_api' in url:
        return await r.fulfill(status=200, content_type='text/javascript', body=MOCK)
    return await r.abort()

async def ctx(browser, w=1440, h=900, mobile=False):
    c = await browser.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, device_scale_factor=1)
    await c.route(re.compile(r'^https?://(?!localhost).*'), route)
    return c

async def signup(page, name):
    await page.goto(BASE + '/signup')
    await page.get_by_label('Display name').fill(name)
    await page.get_by_label('Email').fill(f'{name.lower()}{random.randint(1000,99999)}@example.com')
    await page.get_by_label('Password').fill('password123')
    await page.get_by_role('button', name='Create account').click()
    await page.wait_for_url('**/dashboard')

async def ptime(page):
    return await page.evaluate('() => window.__players?.at(-1)?.getCurrentTime() ?? null')
async def pstate(page):
    return await page.evaluate('() => window.__players?.at(-1)?.getPlayerState() ?? null')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        A = await ctx(browser); a = await A.new_page()
        errors = []
        a.on('pageerror', lambda e: errors.append(str(e)))

        # Landing
        await a.goto(BASE + '/'); await a.wait_for_selector('.card'); await a.wait_for_timeout(1200)
        await a.screenshot(path=f'{SHOTS}/01-landing.png')
        await a.screenshot(path=f'{SHOTS}/01b-landing-full.png', full_page=True)
        await a.get_by_role('button', name='Anime').click()
        n_anime = await a.locator('.grid .card').count()
        check('Category filter: Anime', n_anime == 3, f'{n_anime} cards')
        await a.get_by_label('Search titles').fill('zzzz')
        check('Search empty state', await a.get_by_text('Nothing matches').is_visible())
        await a.get_by_role('button', name='Clear filters').click()
        await a.get_by_label('Search titles').fill('bunny')
        check('Search finds Big Buck Bunny', await a.locator('.grid .card').count() == 1)
        await a.goto(BASE + '/title/sintel'); await a.wait_for_selector('.detail-title'); await a.wait_for_timeout(500)
        await a.screenshot(path=f'{SHOTS}/02-title.png')

        # Protected route redirect
        await a.goto(BASE + '/dashboard'); await a.wait_for_url('**/signin')
        check('Protected route redirects to sign-in', '/signin' in a.url)

        await signup(a, 'Asha')
        await a.screenshot(path=f'{SHOTS}/03-dashboard-empty.png')

        # Watchlist save
        await a.goto(BASE + '/'); await a.wait_for_selector('.card')
        await a.get_by_role('button', name='Save Sintel to watchlist').click()
        await a.wait_for_timeout(400)
        await a.goto(BASE + '/watchlist'); await a.wait_for_selector('.card')
        check('Watchlist persists saved title', await a.locator('.card').count() == 1)

        # Create room via UI
        await a.goto(BASE + '/rooms/new'); await a.wait_for_selector('.pick')
        await a.get_by_label('Room name').fill('Friday film club')
        await a.locator('.pick', has_text='Big Buck Bunny').click()
        await a.screenshot(path=f'{SHOTS}/04-create-room.png', full_page=True)
        await a.get_by_role('button', name='Create room').click()
        await a.wait_for_url('**/room/*'); await a.wait_for_selector('.code-display')
        code = (await a.locator('.code-display').inner_text()).strip()
        check('Room created with 8-char code', re.fullmatch(r'[A-HJ-NP-Z2-9]{8}', code), code)
        await a.wait_for_timeout(600)
        await a.screenshot(path=f'{SHOTS}/05-invite-modal.png')
        invite = await a.locator('#invite-link').input_value()
        await a.get_by_role('button', name='Done').click()

        # Second browser joins with invite link
        B = await ctx(browser); b = await B.new_page()
        b.on('pageerror', lambda e: errors.append(str(e)))
        await b.goto(invite); await b.wait_for_url('**/signin')
        await b.get_by_role('link', name='Create an account').click()
        await b.get_by_label('Display name').fill('Bilal')
        await b.get_by_label('Email').fill(f'bilal{random.randint(1000,99999)}@example.com')
        await b.get_by_label('Password').fill('password123')
        await b.get_by_role('button', name='Create account').click()
        await b.wait_for_url(f'**/join/{code}'); await b.wait_for_selector('text=Join room')
        check('Invite link returns to join page after sign-up', f'/join/{code}' in b.url)
        await b.screenshot(path=f'{SHOTS}/06-join-preview.png')
        await b.get_by_role('button', name='Join room').click()
        await b.wait_for_url(f'**/room/{code}'); await b.wait_for_selector('.controls')
        await a.wait_for_timeout(800)

        # Presence
        await a.get_by_role('tab', name=re.compile('People')).click()
        await expect(a.locator('.person', has_text='Bilal').locator('.presence.on')).to_be_visible()
        check('Host sees guest online', True)
        await a.get_by_role('tab', name=re.compile('Chat')).click()

        # Guest can't control
        check('Guest play button disabled', await b.get_by_role('button', name='Play for everyone').is_disabled())

        # Play sync
        await a.get_by_role('button', name='Play for everyone').click()
        await b.wait_for_function('() => window.__players?.at(-1)?.getPlayerState() === 1', timeout=8000)
        await a.wait_for_timeout(2500)
        ta, tb = await ptime(a), await ptime(b)
        check('Play: both playing and within 1s', abs(ta - tb) < 1.0 and await pstate(b) == 1, f'A={ta:.2f} B={tb:.2f}')

        # Pause sync
        await a.get_by_role('button', name='Pause for everyone').click()
        await b.wait_for_function('() => window.__players?.at(-1)?.getPlayerState() === 2', timeout=5000)
        await a.wait_for_timeout(700)
        ta, tb = await ptime(a), await ptime(b)
        check('Pause: both paused at same position', abs(ta - tb) < 0.5, f'A={ta:.2f} B={tb:.2f}')

        # Seek sync (keyboard: ArrowRight = +10s)
        await a.locator('body').click(position={'x': 5, 'y': 400})
        before = await ptime(b)
        await a.keyboard.press('ArrowRight'); await a.wait_for_timeout(1200)
        ta, tb = await ptime(a), await ptime(b)
        check('Seek +10s reaches guest', abs(tb - (before + 10)) < 1.0 and abs(ta - tb) < 0.5, f'before={before:.1f} A={ta:.1f} B={tb:.1f}')

        # Drift correction: push guest 6s ahead while playing
        await a.get_by_role('button', name='Play for everyone').click()
        await a.wait_for_timeout(1500)
        await b.evaluate('() => { const p = window.__players.at(-1); p.seekTo(p.getCurrentTime() + 6); }')
        drifted = abs(await ptime(a) - await ptime(b))
        await a.wait_for_timeout(1800)
        fixed = abs(await ptime(a) - await ptime(b))
        check('Drift detected and corrected', drifted > 5 and fixed < 1.0, f'drift {drifted:.2f}s -> {fixed:.2f}s')

        # Chat both ways
        await b.get_by_label('Message', exact=True).fill('This bunny is enormous')
        await b.keyboard.press('Enter')
        await expect(a.locator('.msg-text', has_text='This bunny is enormous')).to_be_visible(timeout=4000)
        await a.get_by_label('Message', exact=True).fill('Wait for the squirrel bit')
        await a.get_by_role('button', name='Send message').click()
        await expect(b.locator('.msg-text', has_text='Wait for the squirrel bit')).to_be_visible(timeout=4000)
        check('Chat delivered in both directions', True)

        # Reactions
        await a.get_by_role('button', name='React with 🔥').click()
        await expect(b.locator('.floater', has_text='🔥')).to_be_visible(timeout=3000)
        check('Reaction floats on guest screen', True)
        await b.get_by_role('button', name='React with 😂').click()
        await a.wait_for_timeout(500)
        await a.screenshot(path=f'{SHOTS}/07-room-host.png')
        await b.screenshot(path=f'{SHOTS}/08-room-guest.png')

        # Late joiner
        C = await ctx(browser, 390, 844, mobile=True); c = await C.new_page()
        await signup(c, 'Chen')
        await c.goto(f'{BASE}/join/{code}'); await c.get_by_role('button', name='Join room').click()
        await c.wait_for_selector('.controls')
        await c.wait_for_function('() => window.__players?.at(-1)?.getPlayerState() === 1', timeout=8000)
        await c.wait_for_timeout(1500)
        ta, tc = await ptime(a), await ptime(c)
        check('Late joiner lands at the room position', abs(ta - tc) < 1.0, f'A={ta:.2f} C={tc:.2f}')
        hist = await c.locator('.msg-text', has_text='This bunny is enormous').count()
        check('Late joiner gets chat history', hist == 1)
        await c.screenshot(path=f'{SHOTS}/09-room-mobile.png')
        await c.screenshot(path=f'{SHOTS}/09b-room-mobile-full.png', full_page=True)

        # Refresh recovery
        await b.reload(); await b.wait_for_selector('.controls')
        await b.wait_for_function('() => window.__players?.at(-1)?.getPlayerState() === 1', timeout=8000)
        await b.wait_for_timeout(1500)
        ta, tb = await ptime(a), await ptime(b)
        check('Refreshed guest recovers video + position', abs(ta - tb) < 1.0, f'A={ta:.2f} B={tb:.2f}')
        check('Refreshed guest keeps chat history', await b.locator('.msg-text', has_text='Wait for the squirrel bit').count() == 1)

        # Network drop + reconnect
        await B.set_offline(True)
        await b.wait_for_selector('text=Reconnecting', timeout=25000)
        await a.get_by_role('button', name='Pause for everyone').click()
        await a.wait_for_timeout(500)
        await B.set_offline(False)
        await b.wait_for_selector('.chip-sync >> text=Live', timeout=20000)
        await b.wait_for_function('() => window.__players?.at(-1)?.getPlayerState() === 2', timeout=8000)
        ta, tb = await ptime(a), await ptime(b)
        check('After reconnect guest picks up missed pause', abs(ta - tb) < 0.6, f'A={ta:.2f} B={tb:.2f}')

        # Dashboard with room
        await a.goto(BASE + '/dashboard'); await a.wait_for_selector('.room-row'); await a.wait_for_timeout(300)
        await a.screenshot(path=f'{SHOTS}/10-dashboard.png')
        await a.goto(f'{BASE}/room/{code}'); await a.wait_for_selector('.controls')

        # Invalid / unauthorized
        await b.goto(BASE + '/join/ZZZZZZZZ'); await b.wait_for_selector('.state')
        check('Unknown room code rejected', await b.get_by_text('No room with that code').is_visible())
        await b.screenshot(path=f'{SHOTS}/11-bad-code.png')
        await b.goto(BASE + '/join/oops'); await b.wait_for_selector('.state')
        check('Malformed code rejected', await b.get_by_text('No room with that code').is_visible())
        X = await ctx(browser); x = await X.new_page()
        await x.goto(f'{BASE}/room/{code}'); await x.wait_for_url('**/signin')
        check('Anonymous visitor to room is sent to sign-in', True)
        await signup(x, 'Xena')
        await x.goto(f'{BASE}/room/{code}'); await x.wait_for_selector('.state')
        check('Signed-in non-member cannot open room directly', await x.get_by_text('not in this room yet').is_visible())
        status = await x.evaluate(f"async () => (await fetch('/api/rooms/{code}/messages')).status")
        check('Non-member chat history API is 403', status == 403, str(status))
        await x.goto(BASE + '/nowhere'); await x.screenshot(path=f'{SHOTS}/12-404.png')

        # Settings & profile shots
        await a.goto(BASE + '/profile'); await a.wait_for_timeout(500); await a.screenshot(path=f'{SHOTS}/13-profile.png')
        await a.goto(BASE + '/settings'); await a.wait_for_timeout(300); await a.screenshot(path=f'{SHOTS}/14-settings.png')

        # Mobile landing
        M = await ctx(browser, 390, 844, mobile=True); m = await M.new_page()
        await m.goto(BASE + '/'); await m.wait_for_selector('.card'); await m.wait_for_timeout(1200)
        await m.screenshot(path=f'{SHOTS}/15-landing-mobile.png')
        sw = await m.evaluate('() => document.documentElement.scrollWidth')
        check('No horizontal scroll on mobile landing', sw <= 390, f'scrollWidth={sw}')
        await m.goto(BASE + '/signin'); await m.wait_for_timeout(300); await m.screenshot(path=f'{SHOTS}/16-signin-mobile.png')

        # Host closes room -> guest is notified
        await b.goto(f'{BASE}/room/{code}'); await b.wait_for_selector('.controls')
        await a.goto(f'{BASE}/room/{code}'); await a.wait_for_selector('.controls')
        await a.get_by_role('tab', name=re.compile('People')).click()
        await a.get_by_role('button', name='Close room').click()
        await a.screenshot(path=f'{SHOTS}/17-close-confirm.png')
        await a.get_by_role('dialog').get_by_role('button', name='Close room').click()
        await b.wait_for_selector('text=This room is closed', timeout=5000)
        check('Guest sees room closed', True)
        await b.screenshot(path=f'{SHOTS}/18-closed.png')

        check('No uncaught page errors', not errors, '; '.join(errors[:3]))
        await browser.close()

    passed = sum(1 for r in results if r[1])
    print(f'\n{passed}/{len(results)} checks passed')
    json.dump(results, open(f'{SHOTS}/results.json', 'w'), indent=1)

asyncio.run(main())
