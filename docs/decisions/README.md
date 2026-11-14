# Décisions d'architecture (ADR)

Une décision structurante = un fichier `NNNN-titre.md` : contexte, options étudiées,
décision, conséquences. On ne réécrit pas un ADR accepté : on en écrit un nouveau qui le
remplace (statut « remplacé par NNNN »).

| N° | Décision |
|---|---|
| 0001 | Modèle comptable à lignes |
| 0002 | Soldes par ancres, reconstruction à rebours et rapprochement |
| 0003 | Investissements : ordres avec effet sur les espèces, PEA intégré (fusion de njord) |
| 0004 | Identités stables (UUID) et empreintes d'import |
| 0005 | Sauvegarde v3 : complète, atomique, idempotente |
| 0006 | Identité visuelle « carnet de comptes » et navigation en 7 sections |
| 0007 | Localisation par clés stables et catalogues CSV `keys,fr,en` |
| 0008 | Garde-fous des imports bancaires |
| 0009 | Synchronisation bancaire DSP2 via Enable Banking |
