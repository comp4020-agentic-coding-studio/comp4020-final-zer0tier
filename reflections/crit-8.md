# Crit 8: It's alive!

## What was the breakthrough that moved the work forward?

The breakthrough was taking the idea from the famous QQ Pets system. Once I had
a game I already understood, the question changed from "what should I build?" to
"how would this system work, and what would meet the requirements?" QQ Pets
already had the pieces: a pet you raise by studying and working, needs you have
to look after, and a world shared with other players. Thinking through how each
piece would work showed me how it could meet the brief. Pets and accounts have to
persist, every change to a pet has to reach other players in real time, and
fights between pets make the game multi-user in a way that matters, not just
several people on the same page.

## What did this work change about who I want to be as a software developer?

It changed how I think about synchronising the page from the server to each
person. Before this, I thought of a page as something one person updates. Now I
think of the server as the one true copy: it changes the database first, then
tells every open window what changed, and each page only shows what the server
says. Getting that right took more than sending messages. A window that
reconnects has to catch up without overwriting newer news, a new player has to
appear in everyone's Arena, and a page has to cope when its session changes in
another tab. I want to be a developer who designs for many people at once from
the start, and I can see how to improve it next: sending only the changes each
person needs, rather than every pet update to everyone.
