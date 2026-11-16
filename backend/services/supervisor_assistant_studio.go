package services

import (
	"fmt"
	"sort"
	"strings"

	"miappfiber/database"
	"miappfiber/models"
)

// Vista del estudio del panel del asistente: la ve quien tiene alcance de todo el estudio (administrador). En vez de
// «sus» empresas, muestra todas las del estudio y deja filtrar por asistente y por supervisor, según la asignación de
// cada empresa (companies.assistant_user_id / companies.supervisor_user_id).

// AssistantStudioOption un asistente o supervisor del estudio con cuántas empresas tiene asignadas.
type AssistantStudioOption struct {
	UserID    uint   `json:"user_id"`
	Name      string `json:"name"`
	Companies int    `json:"companies"`
	// Supervisors (solo en los asistentes) los supervisores de las empresas del asistente y cuántas son de cada uno: al filtrar por
	// supervisor, la lista de asistentes muestra solo los que tienen empresas de ese supervisor.
	Supervisors []AssistantStudioCount `json:"supervisors,omitempty"`
}

// AssistantStudioCount un usuario relacionado y cuántas empresas comparten.
type AssistantStudioCount struct {
	UserID    uint `json:"user_id"`
	Companies int  `json:"companies"`
}

// AssistantStudioInfo opciones de los filtros de la vista del estudio. Se calculan sobre TODAS las empresas activas
// del estudio (no sobre las ya filtradas), para que elegir uno no haga desaparecer a los demás de la lista.
type AssistantStudioInfo struct {
	Assistants  []AssistantStudioOption `json:"assistants"`
	Supervisors []AssistantStudioOption `json:"supervisors"`
	// WithoutAssistant / WithoutSupervisor empresas activas sin asistente o sin supervisor asignado.
	WithoutAssistant  int `json:"without_assistant"`
	WithoutSupervisor int `json:"without_supervisor"`
}

// StudioAssistantScope resuelve la vista del estudio: las empresas a mostrar según los filtros, las opciones de los
// filtros y el asistente de cada empresa. ids == nil significa «todo el estudio» (sin filtro); con filtro es la lista
// explícita, y si ninguna empresa coincide queda vacía (no nil), que el panel muestra en cero.
func (s *SupervisorService) StudioAssistantScope(assistantID, supervisorID uint) (ids []uint, info *AssistantStudioInfo, assistantOf map[uint]string, err error) {
	var rows []struct {
		ID               uint
		AssistantUserID  *uint
		SupervisorUserID *uint
	}
	if err = database.DB.Model(&models.Company{}).
		Select("id, assistant_user_id, supervisor_user_id").
		Where("client_type = ? AND status = ?", models.CompanyClientTypeEstudio, "activo").
		Scan(&rows).Error; err != nil {
		return nil, nil, nil, err
	}

	userIDs := make([]uint, 0)
	seenUser := map[uint]bool{}
	byAssistant, bySupervisor := map[uint]int{}, map[uint]int{}
	pairs := map[uint]map[uint]int{} // asistente → supervisor → empresas
	info = &AssistantStudioInfo{Assistants: []AssistantStudioOption{}, Supervisors: []AssistantStudioOption{}}
	remember := func(id uint) {
		if !seenUser[id] {
			seenUser[id] = true
			userIDs = append(userIDs, id)
		}
	}
	for _, r := range rows {
		if r.AssistantUserID != nil && *r.AssistantUserID != 0 {
			byAssistant[*r.AssistantUserID]++
			remember(*r.AssistantUserID)
		} else {
			info.WithoutAssistant++
		}
		if r.SupervisorUserID != nil && *r.SupervisorUserID != 0 {
			bySupervisor[*r.SupervisorUserID]++
			remember(*r.SupervisorUserID)
			if r.AssistantUserID != nil && *r.AssistantUserID != 0 {
				if pairs[*r.AssistantUserID] == nil {
					pairs[*r.AssistantUserID] = map[uint]int{}
				}
				pairs[*r.AssistantUserID][*r.SupervisorUserID]++
			}
		} else {
			info.WithoutSupervisor++
		}
	}
	names := s.userNames(userIDs)
	nameOf := func(id uint) string {
		if n := strings.TrimSpace(names[id]); n != "" {
			return n
		}
		return fmt.Sprintf("Usuario %d", id)
	}
	build := func(counts map[uint]int) []AssistantStudioOption {
		out := make([]AssistantStudioOption, 0, len(counts))
		for id, n := range counts {
			out = append(out, AssistantStudioOption{UserID: id, Name: nameOf(id), Companies: n})
		}
		sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
		return out
	}
	info.Assistants, info.Supervisors = build(byAssistant), build(bySupervisor)
	for i := range info.Assistants {
		for sup, n := range pairs[info.Assistants[i].UserID] {
			info.Assistants[i].Supervisors = append(info.Assistants[i].Supervisors, AssistantStudioCount{UserID: sup, Companies: n})
		}
		sort.Slice(info.Assistants[i].Supervisors, func(a, b int) bool {
			return info.Assistants[i].Supervisors[a].UserID < info.Assistants[i].Supervisors[b].UserID
		})
	}

	assistantOf = make(map[uint]string, len(rows))
	for _, r := range rows {
		if r.AssistantUserID != nil && *r.AssistantUserID != 0 {
			assistantOf[r.ID] = nameOf(*r.AssistantUserID)
		}
	}

	if assistantID == 0 && supervisorID == 0 {
		return nil, info, assistantOf, nil
	}
	ids = make([]uint, 0)
	for _, r := range rows {
		if assistantID != 0 && (r.AssistantUserID == nil || *r.AssistantUserID != assistantID) {
			continue
		}
		if supervisorID != 0 && (r.SupervisorUserID == nil || *r.SupervisorUserID != supervisorID) {
			continue
		}
		ids = append(ids, r.ID)
	}
	return ids, info, assistantOf, nil
}
