package net.sailmc.gateway.limbo;

public interface SailLimboController {
    SailLimboController DISABLED = new SailLimboController() {
        @Override
        public boolean available() {
            return false;
        }

        @Override
        public int waitingCount() {
            return 0;
        }

        @Override
        public void dispose() {}
    };

    boolean available();

    int waitingCount();

    void dispose();
}
