import com.neverlift.backend.race.online.OnlineRaceSession;
import com.neverlift.backend.race.physics.*;
import java.util.*;

/** Offline capacity diagnostic: no database, HTTP, sockets or account writes. */
class OnlineQualifyingProbe {
    public static void main(String[] args) {
        var contract = new PhysicsContract();
        var session = new OnlineRaceSession(contract, PhysicsContract.resource("tracks/suzuka.json"), List.of(
                new OnlineRaceSession.Participant("a", new UUID(0,1), "A", "#365f82", false),
                new OnlineRaceSession.Participant("b", new UUID(0,2), "B", "#a84448", false),
                new OnlineRaceSession.Participant("c", null, "Bot", "#3f704f", true)), 2, "easy", 0);
        for (int block=0; block<6; block++) {
            double[] times = new double[90], snapshots = new double[90];
            for (int i=0; i<90; i++) {
                int tick=block*90+i;
                long now=tick*33_333_333L;
                session.input("a",new DriverInput(1,0,0),tick,now);
                session.input("b",new DriverInput(1,0,0),tick,now);
                long start=System.nanoTime(); session.tick(now);
                long after=System.nanoTime(); session.snapshot(); session.drainEvents();
                times[i]=(after-start)/1e6; snapshots[i]=(System.nanoTime()-after)/1e6;
            }
            Arrays.sort(times); Arrays.sort(snapshots);
            System.out.printf(Locale.ROOT,"block %d, tick mean %.3f p95 %.3f max %.3f ms; snapshot mean %.3f p95 %.3f; phase %s%n",
                    block,Arrays.stream(times).average().orElse(0),times[85],times[89],Arrays.stream(snapshots).average().orElse(0),snapshots[85],session.phase());
        }
    }
}
