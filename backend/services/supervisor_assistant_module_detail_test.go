package services

import (
	"strings"
	"testing"
	"time"

	"miappfiber/models"
)

func TestAssistantBucket_CategoriasDeLasColumnas(t *testing.T) {
	today := time.Date(2026, 11, 16, 0, 0, 0, 0, time.Local)
	past := today.AddDate(0, 0, -3)
	future := today.AddDate(0, 0, 4)
	cases := []struct {
		name   string
		state  string
		onTime bool
		due    *time.Time
		want   string
	}{
		{"entregada a tiempo", assistantTaskDone, true, &past, AssistantBucketDentro},
		{"entregada tarde", assistantTaskDone, false, &past, AssistantBucketFuera},
		{"vencida", assistantTaskOverdue, false, &past, AssistantBucketVencida},
		{"pendiente en plazo", assistantTaskPending, false, &future, AssistantBucketPorVencer},
		{"en revisión del supervisor", assistantTaskInReview, false, &past, AssistantBucketPorVencer},
		{"observada con el plazo vencido cuenta como vencida", assistantTaskObserved, false, &past, AssistantBucketVencida},
		{"observada en plazo", assistantTaskObserved, false, &future, AssistantBucketPorVencer},
		{"observada sin plazo", assistantTaskObserved, false, nil, AssistantBucketPorVencer},
	}
	for _, c := range cases {
		if got := assistantBucket(c.state, c.onTime, c.due, today); got != c.want {
			t.Errorf("%s: %s, quería %s", c.name, got, c.want)
		}
	}
	if rucDigit("20123456789") != 9 || rucDigit("") != -1 || rucDigit("2012345678X") != -1 {
		t.Error("rucDigit")
	}
}

// Al filtrar por supervisor, la lista de asistentes trae solo los que tienen empresas de ese supervisor, con cuántas.
func TestStudioScope_AsistentesPorSupervisor(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()
	mk := func(name string) models.User {
		u := models.User{Name: name, Username: strings.ToLower(name)}
		if err := db.Create(&u).Error; err != nil {
			t.Fatal(err)
		}
		return u
	}
	claudia, rosa := mk("Claudia"), mk("Rosa")
	ana, luis, eva := mk("Ana"), mk("Luis"), mk("Eva")
	add := func(code string, sup, asst *models.User) {
		co := models.Company{RUC: "20" + code + "1", BusinessName: "Empresa " + code, InternalCode: code, ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &sup.ID, AssistantUserID: &asst.ID}
		if err := db.Create(&co).Error; err != nil {
			t.Fatal(err)
		}
	}
	add("A1", &claudia, &ana)
	add("A2", &claudia, &ana)
	add("A3", &rosa, &ana) // Ana atiende empresas de las dos supervisoras
	add("L1", &claudia, &luis)
	add("E1", &rosa, &eva)

	_, info, _, err := svc.StudioAssistantScope(0, 0)
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]map[uint]int{}
	for _, a := range info.Assistants {
		by[a.Name] = map[uint]int{}
		for _, s := range a.Supervisors {
			by[a.Name][s.UserID] = s.Companies
		}
	}
	if by["Ana"][claudia.ID] != 2 || by["Ana"][rosa.ID] != 1 || by["Luis"][claudia.ID] != 1 || by["Luis"][rosa.ID] != 0 || by["Eva"][rosa.ID] != 1 || by["Eva"][claudia.ID] != 0 {
		t.Fatalf("supervisores por asistente: %+v", by)
	}
	// El total de empresas de cada asistente no cambia (el filtro de la pantalla usa los pares).
	for _, a := range info.Assistants {
		if a.Name == "Ana" && a.Companies != 3 {
			t.Errorf("Ana: %d empresas, quería 3", a.Companies)
		}
	}
}

// El módulo del asistente es la ENTREGA DE ARCHIVADORES; la declaración es otra tarea.
func TestAssistantOverview_TituloDelArchivador(t *testing.T) {
	if pdt621ArchivadorLabel != "PDT 621 - Entrega de archivadores" {
		t.Fatalf("título: %q", pdt621ArchivadorLabel)
	}
	opts := assistantModuleOptions(true)
	var found bool
	for _, o := range opts {
		if o.Key == models.SupervisorDeclPDT621 && o.Label == "PDT 621 - Entrega de archivadores" {
			found = true
		}
		if o.Key == pdt621DeclarationKey && o.Label != "PDT 621 · Declaración" {
			t.Errorf("la declaración conserva su título: %q", o.Label)
		}
	}
	if !found {
		t.Fatalf("opciones: %+v", opts)
	}
}

// El detalle del módulo trae una fila por empresa (también las entregadas), con la observación del supervisor, la fecha de
// declaración, el asistente y el dígito; y los comprobantes de ventas y compras salen por asistente.
func TestAssistantModuleDetail_FilasObservacionYComprobantes(t *testing.T) {
	db := setupDashboardOverviewTestDB(t)
	svc := NewSupervisorService()
	mk := func(name string) models.User {
		u := models.User{Name: name, Username: strings.ToLower(name)}
		if err := db.Create(&u).Error; err != nil {
			t.Fatal(err)
		}
		return u
	}
	claudia, ana, luis := mk("Claudia"), mk("Ana"), mk("Luis")
	mkCo := func(ruc, code string, asst *models.User) models.Company {
		co := models.Company{RUC: ruc, BusinessName: "Empresa " + code, InternalCode: code, ClientType: models.CompanyClientTypeEstudio, Status: "activo", SupervisorUserID: &claudia.ID, AssistantUserID: &asst.ID}
		if err := db.Create(&co).Error; err != nil {
			t.Fatal(err)
		}
		return co
	}
	a := mkCo("20100000013", "D3", &ana)  // dígito 3, declaró con observación y comprobantes
	b := mkCo("20100000021", "D1", &ana)  // dígito 1, sin registro
	c := mkCo("20100000047", "D7", &luis) // dígito 7, declaró sin comprobantes
	if _, err := svc.CreatePeriod("2026-07", "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SavePdt621Record(a.ID, "2026-07", Pdt621RecordInput{FechaDeclaracion: "2026-07-20", Observacion: "Se declaró fuera de plazo por falta de documentos", CantidadComprobantesVenta: 120, CantidadComprobantesCompra: 80}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SavePdt621Record(c.ID, "2026-07", Pdt621RecordInput{FechaDeclaracion: "2026-07-18"}); err != nil {
		t.Fatal(err)
	}

	p := SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{a.ID, b.ID, c.ID}, IncludeSupervisorTasks: true, ModuleKey: pdt621DeclarationKey}
	d, err := svc.AssistantModuleDetail(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Rows) != 3 {
		t.Fatalf("filas = %d, quería 3 (una por empresa)", len(d.Rows))
	}
	byCo := map[uint]AssistantModuleRow{}
	for _, r := range d.Rows {
		byCo[r.CompanyID] = r
	}
	ra, rb, rc := byCo[a.ID], byCo[b.ID], byCo[c.ID]
	if ra.Digit != 3 || ra.Assistant != "Ana" || ra.State != assistantTaskDone || ra.DeliveredAt != "2026-07-20" || ra.Observacion != "Se declaró fuera de plazo por falta de documentos" {
		t.Errorf("fila declarada: %+v", ra)
	}
	if ra.Bucket != AssistantBucketDentro && ra.Bucket != AssistantBucketFuera {
		t.Errorf("una declarada cae en dentro o fuera: %s", ra.Bucket)
	}
	if rb.Digit != 1 || rb.State == assistantTaskDone || rb.DeliveredAt != "" || rb.Observacion != "" {
		t.Errorf("fila sin declarar: %+v", rb)
	}
	if rc.Digit != 7 || rc.Assistant != "Luis" || rc.Observacion != "" {
		t.Errorf("fila de Luis: %+v", rc)
	}
	// Orden: lo vencido y lo por vencer van antes que lo ya entregado.
	for i := 1; i < len(d.Rows); i++ {
		if assistantBucketRank[d.Rows[i-1].Bucket] > assistantBucketRank[d.Rows[i].Bucket] {
			t.Fatalf("filas fuera de orden: %s antes de %s", d.Rows[i-1].Bucket, d.Rows[i].Bucket)
		}
	}

	// El consolidado por dígito y las filas cuentan lo mismo.
	ov, err := svc.AssistantOverview(p)
	if err != nil {
		t.Fatal(err)
	}
	var decl *AssistantModuleProgress
	for i := range ov.Modules {
		if ov.Modules[i].Key == pdt621DeclarationKey {
			decl = &ov.Modules[i]
		}
	}
	if decl == nil || decl.Total != int64(len(d.Rows)) {
		t.Fatalf("el módulo y el detalle deben coincidir: %+v vs %d filas", decl, len(d.Rows))
	}
	for _, dg := range decl.ByDigit {
		n := 0
		for _, r := range d.Rows {
			if r.Digit == dg.Digit {
				n++
			}
		}
		if int64(n) != dg.Total {
			t.Errorf("dígito %d: %d filas, el consolidado dice %d", dg.Digit, n, dg.Total)
		}
	}

	// Comprobantes por asistente: Ana 120 + 80 (una empresa sin dato); Luis sin dato.
	if decl.Comprobantes == nil {
		t.Fatal("el módulo Declaración trae los comprobantes por asistente")
	}
	cl := decl.Comprobantes
	if cl.Ventas != 120 || cl.Compras != 80 || cl.Companies != 3 || cl.NoData != 2 || len(cl.ByAssistant) != 2 {
		t.Fatalf("comprobantes: %+v", cl)
	}
	if first := cl.ByAssistant[0]; first.Name != "Ana" || first.Ventas != 120 || first.Compras != 80 || first.Companies != 2 || first.NoData != 1 || first.Open != 1 {
		t.Errorf("Ana: %+v", first)
	}
	if second := cl.ByAssistant[1]; second.Name != "Luis" || second.Ventas != 0 || second.NoData != 1 {
		t.Errorf("Luis: %+v", second)
	}

	// Validaciones: módulo obligatorio y válido; sin la vista del estudio la declaración no es un módulo elegible.
	if _, err := svc.AssistantModuleDetail(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{a.ID}, ModuleKey: "nada"}); err == nil {
		t.Error("un módulo inválido debía fallar")
	}
	if _, err := svc.AssistantModuleDetail(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{a.ID}, ModuleKey: pdt621DeclarationKey}); err == nil {
		t.Error("la declaración solo existe en la vista del estudio")
	}
	if _, err := svc.AssistantModuleDetail(SupervisorDashboardParams{PeriodYM: "2026/07", AllowedCompanyIDs: []uint{a.ID}, ModuleKey: models.SupervisorDeclPDT621}); err == nil {
		t.Error("un periodo inválido debía fallar")
	}
	// Archivador: también trae una fila por empresa.
	arch, err := svc.AssistantModuleDetail(SupervisorDashboardParams{PeriodYM: "2026-07", AllowedCompanyIDs: []uint{a.ID, b.ID, c.ID}, ModuleKey: models.SupervisorDeclPDT621})
	if err != nil || len(arch.Rows) != 3 {
		t.Fatalf("archivador: %d filas, err=%v", len(arch.Rows), err)
	}
}
