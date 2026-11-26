# Diceball

A turn-based baseball dice game for two teams on one screen. Nine innings, two dice per at-bat, and a Battle whenever a good double comes up. Play with a friend, or against the computer.

**Play it:** https://chriskosho.github.io/diceball/

## Install it as an app

Open the link above, then:

- **iPhone or iPad:** in Safari, tap Share, then Add to Home Screen.
- **Android:** in Chrome, tap Install app (or the menu, then Add to home screen).
- **Computer:** in Chrome or Edge, click the install icon in the address bar, or use Install app on the new game screen.

Once it's installed it opens full screen and works with no internet connection. The game is a single file, `index.html`.

## How it plays

The visitors bat first. Each at-bat, the batter rolls two dice and the dice chart decides what happens. Three outs ends the half-inning. After the set number of innings (nine by default), the team with more runs wins; a tie goes to extra innings. The home team skips the bottom of the last inning if it is already ahead, and a walk-off ends the game the moment the home team takes the lead.

- **Singles, doubles and triples** move every runner up one, two, or all the way home. A home run scores everyone.
- **Walks and hit by pitch** move runners only when they are forced.
- **Outs** never move runners. A double play is 2 outs and a triple play is 3.
- **Battles:** when the batter rolls a good double (1-1, 4-4, 5-5 or 6-6), the batter rolls a die, then the defending team rolls theirs. Higher wins, ties roll again. If the batter wins, the result stands. If the defender wins, it is an out.

The full dice chart, with odds, is in the app (Menu, then Dice chart). It lives in one constant (`CHART`) at the top of the script, so it is easy to retune.

## Features

- Two people on one screen, a person against the computer, or two computer teams
- Real-place team names (Texas and US cities), editable, with a button to pick teams for you
- 3, 5, 7 or 9 innings
- Tossed dice, or an Immersive 3D throw you flick across the screen (Menu, then Dice rolling)
- Animations on or off, light or dark appearance, sound, and an optional game log
- Linescore with runs and hits, a diamond with runners and out lights
- Undo the last roll
- Autosave: reopening a game in progress offers Resume game or Start a new game
- Installable on phones, tablets and computers, and playable offline
- Updates itself: when a new version is published, the app saves your game, reloads, picks up where you were, and shows a What's new window

## Tests

The checks run on every push through GitHub Actions (`tests/run-tests.mjs`): the rules (chart odds, base running, outs, walk-offs, extra innings, battles), 300 whole games with random dice, a computer game played through the interface, a person's turns with animations, the Immersive throw, the installable app and offline reload, and the update flow. The site deploys only when they pass.

To run them yourself: `npm install --no-save playwright-core`, then `CHROME_PATH=/path/to/chrome node tests/run-tests.mjs`.

## Releasing

Every change that should reach players needs a new `APP_VERSION` and a new entry at the top of `RELEASES`, both near the top of the script in `index.html`. The deploy step publishes the version number as `version.json`, and running copies check it every few minutes and whenever the app comes back to the screen. When it differs from their own, they reload and show the entries they haven't seen yet. A test fails if the two don't match.

## Disclaimer

Diceball is an original game. It is not affiliated with or endorsed by any league, team or game publisher.
