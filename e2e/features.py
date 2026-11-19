"""
End-to-end journey for the SyncSpace upgrade features. Run it AFTER journey.py against the same live client + API.

Independent browser contexts (separate cookies = separate users) check, in a real browser:
  * the shared watch queue: add, vote, ordering, persistence across reload, automatic advance when a video ends,
    and that members cannot use host-only controls
  * moderation: mute enforced for the muted person, reports reaching moderators, slow mode
  * scheduled watch parties: schedule, invite by email, notification bell, RSVP, cancel + notification
  * account recovery pages and the "email not configured" safety message

YouTube is replaced by `mock_yt.js` (with a short fake duration so videos really end).
Usage:  python3 e2e/features.py e2e/shots     (client at E2E_BASE, default http://localhost:4173)
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

_thumbs = {}
async def route(r):
    url = r.request.url
    if 'i.ytimg.com' in url:
        vid = url.split('/vi/')[1].split('/')[0]
        _thumbs.setdefault(vid, thumb(vid))
        return await r.fulfill(status=200, content_type='image/jpeg', body=_thumbs[vid])
    if 'youtube.com/iframe_api' in url:
        return await r.fulfill(status=200, content_type='text/javascript', body=MOCK)
    return await r.abort()

async def ctx(browser, w=1440, h=900):
    c = await browser.new_context(viewport={'width': w, 'height': h})
    await c.add_init_script('window.__MOCK_DUR = 7;')  # videos last 7 seconds so "ended" really happens
    await c.route(re.compile(r'^https?://(?!localhost).*'), route)
    return c

async def signup(page, name):
    email = f'{name.lower()}{random.randint(1000,99999)}@example.com'
    await page.goto(BASE + '/signup')
    await page.get_by_label('Display name').fill(name)
    await page.get_by_label('Email').fill(email)
    await page.get_by_label('Password').fill('password123')
    await page.get_by_role('button', name='Create account').click()
    await page.wait_for_url('**/dashboard')
    return email

async def shown(locator, timeout=7000):
    """True once the locator becomes visible (waits for async loads instead of sampling once)."""
    try:
        await locator.first.wait_for(state='visible', timeout=timeout)
        return True
    except Exception:
        return False

async def tab(page, name):
    await page.get_by_role('tab', name=re.compile(name)).click()

async def queue_titles(page):
    # Order of videos by id, independent of who is looking ("you" vs a name in the caption).
    return await page.locator('.queue-item .queue-thumb img').evaluate_all('els => els.map(e => e.src.split("/vi/")[1].split("/")[0])')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        errors = []
        H = await ctx(browser); h = await H.new_page(); h.on('pageerror', lambda e: errors.append(str(e)))
        A = await ctx(browser); a = await A.new_page(); a.on('pageerror', lambda e: errors.append(str(e)))
        await signup(h, 'Hosty'); a_email = await signup(a, 'Annie')

        # ---------- room + queue ----------
        await h.goto(BASE + '/rooms/new'); await h.wait_for_selector('.pick')
        await h.get_by_label('Room name').fill('Queue night')
        await h.locator('.pick', has_text='Big Buck Bunny').click()
        await h.get_by_role('button', name='Create room').click()
        await h.wait_for_url('**/room/*'); await h.wait_for_selector('.code-display')
        code = (await h.locator('.code-display').inner_text()).strip()
        await h.get_by_role('button', name='Done').click()
        await a.goto(f'{BASE}/join/{code}'); await a.get_by_role('button', name='Join room').click()
        await a.wait_for_url(f'**/room/{code}'); await a.wait_for_selector('.controls')
        await tab(h, 'Queue'); await tab(a, 'Queue')
        await h.wait_for_timeout(500)

        vid2, vid3 = 'https://youtu.be/xU47nhruN-Q', 'https://youtu.be/R6MlUcmOul8'
        await a.get_by_label('YouTube link to add to the queue').fill('https://example.com/nope')
        await a.get_by_role('button', name='Add', exact=True).click()
        check('Queue rejects a non-YouTube link with a clear message', await a.get_by_text('Use a YouTube link').is_visible())
        await a.get_by_label('YouTube link to add to the queue').fill(vid2)
        await a.get_by_role('button', name='Add', exact=True).click()
        await expect(a.locator('.queue-item')).to_have_count(1)
        await h.get_by_label('YouTube link to add to the queue').fill(vid3)
        await h.get_by_role('button', name='Add', exact=True).click()
        await expect(h.locator('.queue-item')).to_have_count(2)
        await expect(a.locator('.queue-item')).to_have_count(2)
        check('Both browsers see the same queue', (await queue_titles(h)) == (await queue_titles(a)) and len(await queue_titles(h)) == 2)

        # Votes: Annie votes for the host's video; order follows votes on both screens.
        before = await queue_titles(h)
        await a.locator('.queue-item').nth(1).locator('.vote-btn').click()
        first_changed = '(b) => document.querySelector(".queue-item .queue-thumb img").src.split("/vi/")[1].split("/")[0] !== b'
        await h.wait_for_function(first_changed, arg=before[0])
        await a.wait_for_function(first_changed, arg=before[0])
        after_h, after_a = await queue_titles(h), await queue_titles(a)
        check('Vote reorders the queue for everyone', after_h == after_a == [before[1], before[0]], f'{before} -> {after_h}')
        await expect(a.locator('.queue-item').first.locator('.vote-btn')).to_have_attribute('aria-pressed', 'true')
        check('Voted button shows pressed state', True)
        await a.screenshot(path=f'{SHOTS}/f01-queue-guest.png'); await h.screenshot(path=f'{SHOTS}/f02-queue-host.png')

        # Permissions: a guest sees no host-only controls on other people's items.
        a_first = a.locator('.queue-item').first  # host's item
        check('Guest cannot remove or move the host\'s video', await a_first.get_by_label(re.compile('from the queue')).count() == 0
              and await a_first.get_by_role('button', name='Play next').count() == 0)
        check('Guest has no host-only order switch', await a.get_by_role('button', name='Manual').count() == 0)

        # Persistence: reload keeps the queue.
        await a.reload(); await a.wait_for_selector('.controls'); await tab(a, 'Queue')
        await expect(a.locator('.queue-item')).to_have_count(2)
        check('Queue survives a page reload', True)

        # Automatic advance: the 7-second video ends and the top queue item starts for everyone.
        playing_before = await h.evaluate('() => window.__players.at(-1).vid')
        await h.get_by_role('button', name='Play for everyone').click()
        await h.wait_for_function('(b) => window.__players.at(-1).vid !== b', arg=playing_before, timeout=20000)
        await a.wait_for_function('(b) => window.__players.at(-1).vid !== b', arg=playing_before, timeout=10000)
        check('Video end advances every viewer to the next queued video',
              await h.evaluate('() => window.__players.at(-1).vid') == await a.evaluate('() => window.__players.at(-1).vid'))
        await expect(h.locator('.queue-item')).to_have_count(1)
        check('Queue shrank by exactly one entry', True)
        await tab(h, 'Chat')
        check('Room announces the next video', await h.get_by_text(re.compile('Up next')).count() >= 1)

        # ---------- moderation ----------
        await tab(h, 'People'); await tab(a, 'Chat')
        await h.get_by_role('button', name='Mute Annie').click()
        await h.locator('.modal').get_by_role('button', name='Mute', exact=True).click()
        await expect(a.get_by_text('A moderator muted you')).to_be_visible()
        check('Muted guest cannot type', await a.get_by_label(re.compile('Message')).is_disabled() if await a.get_by_label(re.compile('Message')).count() else await a.locator('textarea').is_disabled())
        await a.screenshot(path=f'{SHOTS}/f03-muted.png')
        await h.get_by_role('button', name='Unmute Annie').click()
        await expect(a.get_by_text('A moderator muted you')).to_have_count(0)
        check('Unmuting restores chat', True)

        # Report a person; moderator sees it.
        await tab(a, 'People')
        await a.get_by_role('button', name='Report Hosty').click()
        await a.get_by_role('button', name='Send report').click()
        await expect(a.get_by_text('Report sent to the moderators')).to_be_visible()
        await h.get_by_role('button', name='Moderation').click()
        await expect(h.get_by_text('Open reports (0)')).to_be_visible()
        check('Host cannot see reports about themselves', True)
        await h.get_by_role('button', name='Done').click()
        # The host reports Annie; that one IS reviewable by the host.
        await h.get_by_role('button', name='Report Annie').click()
        await h.get_by_role('button', name='Send report').click()
        await expect(h.get_by_text('Report sent to the moderators')).to_be_visible()
        await h.get_by_role('button', name='Moderation').click()
        await expect(h.get_by_text('Open reports (1)')).to_be_visible()
        await h.screenshot(path=f'{SHOTS}/f04-moderation.png')
        await h.locator('.modal').get_by_role('button', name='Dismiss').click()
        await expect(h.get_by_text('Open reports (0)')).to_be_visible()
        check('Moderator can review and dismiss a report', True)
        await h.get_by_role('button', name='Done').click()

        # ---------- scheduled watch party + notifications ----------
        # Annie already has moderation notifications from the mute above. Mark them all read first.
        await a.goto(BASE + '/dashboard')
        await expect(a.get_by_role('button', name=re.compile('Notifications, \\d+ unread'))).to_be_visible(timeout=8000)
        await a.get_by_role('button', name=re.compile('Notifications')).click()
        await a.get_by_role('button', name='Mark all read').click()
        await expect(a.get_by_role('button', name='Notifications', exact=True)).to_be_visible()
        check('Mark all read clears the badge', True)
        await a.keyboard.press('Escape')

        await h.goto(BASE + '/events/new'); await h.get_by_label('Title').fill('Saturday premiere')
        await h.get_by_role('button', name='Schedule party').click()
        await h.wait_for_url(re.compile(r'.*/events/[0-9a-f]{24}$'))
        event_url = h.url
        await h.get_by_role('heading', name='Saturday premiere').wait_for()
        check('Watch party scheduled', True)
        await h.get_by_role('button', name='Invite people').click()
        await h.get_by_label('Invite by email').fill(a_email + ', nobody@example.com')
        await h.get_by_role('button', name='Send invitations').click()
        await expect(h.get_by_text('Invitations sent')).to_be_visible()
        await h.get_by_role('button', name='Done').click()

        await a.goto(BASE + '/dashboard')
        await expect(a.get_by_role('button', name=re.compile('Notifications, 1 unread'))).to_be_visible(timeout=8000)
        check('Invitee sees an unread notification badge', True)
        await a.get_by_role('button', name=re.compile('Notifications')).click()
        await a.screenshot(path=f'{SHOTS}/f05-notifications.png')
        await a.get_by_role('button', name=re.compile('invited you')).click()
        await a.wait_for_url(re.compile(r'.*/events/[0-9a-f]{24}$'))
        check('Notification opens the event', await shown(a.get_by_role('heading', name='Saturday premiere')))
        await expect(a.get_by_role('button', name=re.compile('^Notifications$'))).to_be_visible()
        check('Opening it marks it read (badge gone)', await a.get_by_role('button', name=re.compile('unread')).count() == 0)
        await a.get_by_role('button', name='I’m going').click()
        await expect(a.get_by_text('You’re going')).to_be_visible()
        check('RSVP going recorded', await a.get_by_role('button', name='I’m going').get_attribute('aria-pressed') == 'true')
        check('Join is blocked until the room opens', await a.get_by_role('button', name='Join the room').is_disabled())
        await a.screenshot(path=f'{SHOTS}/f06-event-guest.png')

        await a.goto(BASE + '/dashboard'); await a.wait_for_selector('.event-row')
        check('Dashboard lists the upcoming party', await a.locator('.event-row', has_text='Saturday premiere').count() == 1)

        # A stranger cannot open a private event.
        S = await ctx(browser); s = await S.new_page(); await signup(s, 'Stranger')
        await s.goto(event_url)
        check('Stranger gets "not found" for a private event', await shown(s.get_by_text('Watch party not found')))
        await S.close()

        # Cancel -> invitee notified.
        await h.goto(event_url); await h.get_by_role('button', name='Cancel party').click()
        await h.locator('.modal').get_by_role('button', name='Cancel party').click()
        await expect(h.get_by_text('Cancelled').first).to_be_visible()
        await a.goto(BASE + '/dashboard')
        await expect(a.get_by_role('button', name=re.compile('Notifications, \\d+ unread'))).to_be_visible(timeout=8000)
        await a.get_by_role('button', name=re.compile('Notifications')).click()
        check('Cancellation notifies people who were going', await shown(a.get_by_text('was cancelled')))

        # ---------- account recovery ----------
        R = await ctx(browser); r = await R.new_page()
        await r.goto(BASE + '/signin'); await r.get_by_role('link', name='Forgot your password?').click()
        await r.wait_for_url('**/forgot-password')
        check('Forgot-password page explains when email is not configured', await r.get_by_text('Email isn’t set up on this server').is_visible() or await r.get_by_role('button', name='Send reset link').is_enabled())
        await r.goto(BASE + '/reset-password')
        check('Reset page without a token is handled', await r.get_by_text('missing its token').is_visible())
        await r.goto(BASE + '/reset-password?token=' + 'a' * 43)
        await r.get_by_label('New password').fill('newpassword1')
        await r.get_by_role('button', name='Change password').click()
        check('Invalid reset token shows a clear error', await shown(r.get_by_text('invalid or has expired')))
        await r.close(); await R.close()

        check('No uncaught page errors', not errors, '; '.join(errors)[:300])
        await browser.close()
    passed = sum(1 for r in results if r[1])
    print(f'\n{passed}/{len(results)} checks passed')
    json.dump(results, open(f'{SHOTS}/features-results.json', 'w'), indent=1)
    if passed != len(results): sys.exit(1)

asyncio.run(main())
