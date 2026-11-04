import { MOTTO } from "../lib/site";

export default function Footer() {
  return (
    <footer className="site-footer">
      {MOTTO && (
        <>
          <p className="footer-motto">{MOTTO}</p>
          <div className="footer-ornament" aria-hidden="true"><span>✦</span></div>
        </>
      )}
      <div className="footer-org">Dahiratoul Moustarchidina Wal Moustarchidaty</div>
      <div>Moustarchidine Junior • Commission Administrative Conseil UGB</div>
      <div>© 2026 Tous droits réservés</div>
    </footer>
  );
}