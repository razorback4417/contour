# Remote Linux collection

Physical collection runs on Linux. Contour binds to the target's loopback
interface, so the UI can be reached through an SSH tunnel without exposing it
to the network.

## Install on the target

If the target can access GitHub, SSH to it and follow the physical topology
quick start in the main README.

If source must be copied from a Mac:

```bash
# On the Mac
git clone https://github.com/razorback4417/contour.git
rsync -az --exclude .git --exclude node_modules --exclude dist --exclude dist-cli contour/ user@host:~/contour/

# On the Linux target
ssh user@host
cd ~/contour
sudo apt install hwloc
npm install
npm link
contour
```

Build on Linux; do not copy `node_modules`, `dist`, or `dist-cli` from another
operating system.

## Open the UI

Keep Contour running on the target. In a second local terminal:

```bash
ssh -N -L 4177:127.0.0.1:4177 user@host
```

Open `http://127.0.0.1:4177`. For later source updates, rerun the same `rsync`
command and `npm install` on the Linux target.
